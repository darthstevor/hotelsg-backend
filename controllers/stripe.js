import User from '../models/user';
import Stripe from 'stripe';
import queryString from 'query-string';
import { login } from './auth';
import Hotel from '../models/hotel';
import Order from '../models/order';

const stripe = Stripe(process.env.STRIPE_SECRET);

export const createConnectAccount = async (req,res) => {
    // console.log("REQ USER FROM REQUIRE_SIGNIN MIDDLEWARE", req.user);
    // console.log('YOU HIT CREATE CONNECT ACCOUNT');
    
    // 1. find user from db
    const user = await User.findById(req.user._id).exec();

    // 2. If user don't have stripe_account_id yet, create now
    if(!user.stripe_account_id) {
        const account = await stripe.accounts.create({
            type: "express",
        });
        console.log("ACCOUNT ===>", account);
        user.stripe_account_id = account.id;
        user.save();
    }

    // 3. create login link based on account id (for frontend to complete boarding)
    let accountLink = await stripe.accountLinks.create({
        account: user.stripe_account_id,
        refresh_url: process.env.STRIPE_REDIRECT_URL,        
        return_url: process.env.STRIPE_REDIRECT_URL,
        type: "account_onboarding"
    });

    // prefill any info such as email
    accountLink = Object.assign(accountLink, {
        "stripe_user[email]": user.email || undefined,
    });
    //console.log('ACCOUNT LINK', accountLink);
    let link = `${accountLink.url}?${queryString.stringify(accountLink)}`;
    console.log('LOGIN LINK', link);
    res.send(link);
    
};

const updateDelayDays = async (accountId) => {
    const account = await stripe.accounts.update(accountId, {
        settings: {
            payouts: {
                schedule: {
                    delay_days: 7,
                },
            },
        },
    });
    return account;
}; 


export const getAccountStatus = async (req, res) => {
    //console.log('GET ACCOUNT STATUS');
    const user = await User.findById(req.user._id).exec();
    const account = await stripe.accounts.retrieve(user.stripe_account_id);
    //console.log('USER ACCOUNT RETRIEVE', account);
    // update delay days
    //console.log(user);
    // const updatedAccount = await User.updateDelayDays(account.id);
    const updatedUser = await User.findByIdAndUpdate
     (user._id, 
         {
             stripe_seller: account,
         }, 
         {new: true}
     )
     .select("-password")
     .exec();
    //console.log(updatedUser);
    res.json(updatedUser);
};

export const getAccountBalance = async (req, res) => {
    const user = await User.findById(req.user._id).exec();
    
    try {
        const balance = await stripe.balance.retrieve({
            stripeAccount: user.stripe_account_id,
        });
        //console.log("BALANCE ===>", balance);
        res.json(balance);
    } catch (err) {
        console.log(err);
    }
};

export const payoutSetting = async (req, res) => {
    try {
        const user = await User.findById(req.user._id).exec();

        const loginLink = await stripe.accounts.createLoginLink(user.stripe_account_id, {
            redirect_url: process.env.STRIPE_SETTING_REDIRECT_URL
        }
        );
        //console.log('LOGIN LINK FOR PAYOUT SETTING', loginLink)
        res.json(loginLink);
    } catch(err) {
        console.log('STRIPE PAYOUT SETTING ERR', err)
    }
};

export const stripeSessionId = async (req, res) => {
    //console.group("You hit stripe session Id", req.body.hotelId); 
    // 1. Get Hotel id from req.body
    const {hotelId} = req.body;

    // 2. Find the hotel based on hotelId from db
    const item = await Hotel.findById(hotelId).populate('postedBy').exec();

    // 3. 20% charge as application fee
    const fee = Math.round((item.price * 20) / 100);

    // 4. Create a session
    const session = await stripe.checkout.sessions.create({
        payment_method_types: ['card'],
    // 5. Purchasing item details it will be shown to user on checkout
        line_items: [
            {
                name: item.title,
                amount: item.price * 100, // in cents
                currency: "eur",
                quantity: 1
            },
        ],
    // 6. Create Payment intent with application fee and destination charge
        payment_intent_data: {
            application_fee_amount: (fee * 100),
            // this seller can see this balance in our frontend dashboard
            transfer_data: {
                destination: item.postedBy.stripe_account_id,
            },
        },
    

        //  Success and cancel url
        success_url: `${process.env.STRIPE_SUCCESS_URL}/${item._id}`,
        cancel_url: process.env.STRIPE_CANCEL_URL,
    });

    // 7. Add this session object to user in the db
    await User.findByIdAndUpdate(req.user._id, {stripeSession: session}).exec();
    // 8. Send Session Id as response to frontend
    res.send({
        sessionId: session.id
    });

    console.log("SESSION==============================================>", session);

};

export const stripeSuccess = async (req, res) => {
    try {
            // 1. Get hotelId from req.body
    const {hotelId} = req.body;
    
    // 2. Find currently logged in User
    const user = await User.findById(req.user._id).exec();
    // check if user has session
    if(!user.stripeSession) return;
    // 3. Retrieve stripe session, based on session id we previously save in user db
    const session = await stripe.checkout.sessions.retrieve(user.stripeSession.id);
    // 4. If session payment status is paid, create order
    if(session.payment_status === 'paid') {
        // 5. check if order with that session id already exist by quering orders collection
        const orderExist = await Order.findOne({"session.id": session.id}).exec();
        if(orderExist) {
            // 6. If Order exists send Success true
            res.json({success: true});
        } else {
            // 7. else create new order and send success true
            let newOrder = await new Order({
                hotel: hotelId,
                session,
                orderedBy: user._id
            }).save();
            // 8. remove user's stripeSession
            await User.findByIdAndUpdate(user._id, {
                $set: {stripeSession: {}},                
            });
            // 9. Send the response
            res.json({success: true});
        }
    }
    } catch(err) {
        console.log("STRIPE SUCCESS ERR", err);
    }
};