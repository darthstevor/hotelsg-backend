import express from 'express';
const router = express.Router();
import { register, login } from '../controllers/auth';



//Create the Endpoint
router.post('/register', register);
router.post('/login', login);

module.exports = router;