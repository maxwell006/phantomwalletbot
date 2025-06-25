const mongoose = require("mongoose");

const userSchema = new mongoose.Schema({
  telegramId: {
    type: String,
    unique: true,
  },
  walletAddress: {
    type: String
  },
});

module.exports = mongoose.model("User", userSchema);
