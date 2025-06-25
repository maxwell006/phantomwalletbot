const mongoose = require("mongoose");
require("dotenv").config();

const mongoDBConnection = async () => {
  try {
    await mongoose.connect(process.env.MONGO_URI);
     console.log('MongoDB connected successfully...');
  } catch (err) {
    console.error(err.message);
  }
};


module.exports = mongoDBConnection;