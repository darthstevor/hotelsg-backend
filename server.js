import express from 'express';
import { readdirSync } from 'fs';
import cors from 'cors';
import mongoose from 'mongoose';
const morgan = require("morgan");
require('dotenv').config();

const app = express();
const cors = require('cors');
const corsOptions ={
    origin:'http://localhost:3000', 
    credentials:true,            //access-control-allow-credentials:true
    optionSuccessStatus:200
}

// db connection
mongoose.connect(process.env.DATABASE, {})
.then(() => console.log('DB Connected'))
.catch((err) => console.log('DB Connection Error: ', err))

// middlewares
app.use(cors(corsOptions));
app.use(morgan("dev"));
app.use(express.json());

app.get('/', (req, res) => {
    res.send('Hello to the Hotel API');
});

//route middleware
readdirSync('./routes').map((r) => app.use('/api', require(`./routes/${r}`)))

const port = process.env.PORT || 8000;

app.listen(port, () => console.log(`Server is running on port ${port}`));