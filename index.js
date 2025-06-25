// Phantom Wallet Telegram Bot (Node.js + MongoDB + Telegraf + Express)

const { Telegraf } = require('telegraf');
const express = require('express');
const mongoose = require('mongoose');
const dotenv = require('dotenv');
const { Connection, PublicKey, clusterApiUrl } = require('@solana/web3.js');
const User = require('./models/User');

dotenv.config();

const app = express();
const bot = new Telegraf(process.env.BOT_TOKEN);

// Connect to MongoDB
mongoose.connect(process.env.MONGO_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true,
}).then(() => console.log('MongoDB connected'))
  .catch((err) => console.error('MongoDB connection error:', err));

// === TELEGRAM COMMANDS ===

// /start
bot.start((ctx) => {
  ctx.reply('👋 Welcome! Use /connect to link your Phantom Wallet.');
});

// /connect
bot.command('connect', (ctx) => {
  const telegramId = ctx.from.id;
  const redirectUrl = `https://phantomwalletbot.onrender.com/wallet-connected?telegramId=${telegramId}`;
  const deeplink = `https://phantom.app/ul/v1/connect?app_url=https://phantomwalletbot.onrender.com&redirect_link=${encodeURIComponent(redirectUrl)}`;

  ctx.reply('🔐 Click below to connect your Phantom Wallet:', {
    reply_markup: {
      inline_keyboard: [[{ text: '🔗 Connect Wallet', url: deeplink }]],
    },
  });
});

// /balance
bot.command('balance', async (ctx) => {
  const telegramId = ctx.from.id;

  try {
    const user = await User.findOne({ telegramId });
    if (!user || !user.walletAddress) {
      return ctx.reply('You haven’t connected your wallet yet. Use /connect first.');
    }

    const connection = new Connection(clusterApiUrl('mainnet-beta'), 'confirmed');
    const balance = await connection.getBalance(new PublicKey(user.walletAddress));
    const sol = balance / 1e9;

    ctx.reply(`Your balance is ${sol} SOL`);
  } catch (err) {
    console.error('Balance check error:', err);
    ctx.reply('Failed to fetch balance. Please try again later.');
  }
});

// === EXPRESS BACKEND ===

// Callback from Phantom after wallet connect
app.get('/wallet-connected', async (req, res) => {
  const { d, telegramId, errorCode, errorMessage } = req.query;

  if (errorCode) {
    return res.send(`Phantom Error: ${decodeURIComponent(errorMessage)}`);
  }

  if (!d || !telegramId) {
    return res.send('Missing connection data. Try again.');
  }

  try {
    const decoded = JSON.parse(Buffer.from(d, 'base64').toString());
    const publicKey = decoded.public_key;

    if (!publicKey) {
      return res.send('No wallet public key returned from Phantom.');
    }

    await User.findOneAndUpdate(
      { telegramId },
      { walletAddress: publicKey },
      { upsert: true, new: true }
    );

    res.send('Wallet connected successfully! You can return to Telegram and use /balance.');
  } catch (err) {
    console.error('Wallet callback error:', err);
    res.send('Failed to connect wallet. Please try again.');
  }
});

// === START SERVERS ===
app.listen(3000, () => console.log('Express server running on port 3000'));
bot.launch().then(() => console.log('Telegram bot is running'));

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
