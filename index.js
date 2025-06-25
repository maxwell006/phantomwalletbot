// === Phantom Wallet Telegram Bot ===
// Telegram + MongoDB + Phantom Deeplink + Solana by Mr. Victor and Mr. Maxwell

const { Telegraf } = require('telegraf');
const express = require('express');
const mongoose = require('mongoose');
const dotenv = require('dotenv');
const { Connection, PublicKey, clusterApiUrl } = require('@solana/web3.js');
const bs58 = require('bs58').default;
const nacl = require('tweetnacl');
const User = require('./models/User');

dotenv.config();

const app = express();
const bot = new Telegraf(process.env.BOT_TOKEN);

// === Generate Phantom Encryption Key ===
const dappKeyPair = nacl.box.keyPair();
const DAPP_ENCRYPTION_PUBLIC_KEY = bs58.encode(dappKeyPair.publicKey);

// === MongoDB Connection ===
mongoose.connect(process.env.MONGO_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true,
}).then(() => console.log('MongoDB connected'))
  .catch(err => console.error('MongoDB Error:', err));

// === Telegram Bot Commands ===

// /start
bot.start((ctx) => {
  ctx.reply('Welcome! Use /connect to link your Phantom Wallet.');
});

// /connect
bot.command('connect', (ctx) => {
  const telegramId = ctx.from.id;
  const rawRedirect = `https://phantomwalletbot.onrender.com/wallet-connected?telegramId=${telegramId}`;

  const deeplink = `https://phantom.app/ul/v1/connect?` +
    `app_url=${encodeURIComponent('https://phantomwalletbot.onrender.com')}` +
    `&redirect_link=${encodeURIComponent(rawRedirect)}` +
    `&dapp_encryption_public_key=${DAPP_ENCRYPTION_PUBLIC_KEY}`;

  ctx.reply('🔐 Click below to connect your Phantom Wallet:', {
    reply_markup: {
      inline_keyboard: [[{ text: 'Connect Wallet', url: deeplink }]],
    },
  });
});

// /balance
bot.command('balance', async (ctx) => {
  const telegramId = ctx.from.id;

  try {
    const user = await User.findOne({ telegramId });
    if (!user || !user.walletAddress) {
      return ctx.reply('Wallet not connected. Use /connect first.');
    }

    const connection = new Connection(clusterApiUrl('mainnet-beta'), 'confirmed');
    const balance = await connection.getBalance(new PublicKey(user.walletAddress));
    const sol = balance / 1e9;

    ctx.reply(`Your wallet balance is ${sol} SOL`);
  } catch (err) {
    console.error('Balance fetch error:', err);
    ctx.reply('Could not fetch balance. Try again.');
  }
});

// === Phantom Callback Route ===
app.get('/wallet-connected', async (req, res) => {
  const { d, telegramId, errorCode, errorMessage } = req.query;

  if (errorCode) {
    return res.send(`Phantom Error: ${decodeURIComponent(errorMessage)}`);
  }

  if (!d || !telegramId) {
    console.log("D:", d);
     console.log("TelegramID:", telegramId);
    return res.send('Missing wallet data or Telegram ID.');
  }

  try {
    const decoded = JSON.parse(Buffer.from(d, 'base64').toString());
    const publicKey = decoded.public_key;

    if (!publicKey) {
      return res.send('No public key returned from Phantom.');
    }

    await User.findOneAndUpdate(
      { telegramId },
      { walletAddress: publicKey },
      { upsert: true, new: true }
    );

    res.send('Wallet connected successfully! Return to Telegram and use /balance.');
  } catch (err) {
    console.error('Wallet connection error:', err);
    res.send('Wallet connection failed. Try again.');
  }
});

// === Start Express and Bot ===
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Express server running on port ${PORT}`));

bot.launch().then(() => console.log('Telegram bot is running'));

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
