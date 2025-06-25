// === Phantom Wallet Telegram Bot with Full Onboarding, History, Naming, and Admin ===

const { Telegraf } = require('telegraf');
const express = require('express');
const mongoose = require('mongoose');
const dotenv = require('dotenv');
const { Connection, PublicKey, clusterApiUrl, Keypair } = require('@solana/web3.js');
const bs58 = require('bs58').default;
const nacl = require('tweetnacl');
const User = require('./models/User');

dotenv.config();

const app = express();
const bot = new Telegraf(process.env.BOT_TOKEN);
const ADMIN_IDS = process.env.ADMIN_IDS ? process.env.ADMIN_IDS.split(',') : [];

// Generate DApp encryption key (for Phantom connect)
const dappKeyPair = nacl.box.keyPair();
const DAPP_ENCRYPTION_PUBLIC_KEY = bs58.encode(dappKeyPair.publicKey);

// MongoDB connection
mongoose.connect(process.env.MONGO_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true,
}).then(() => console.log('MongoDB connected'))
  .catch(err => console.error('MongoDB connection error:', err));

// === Commands ===

bot.start(async (ctx) => {
  const telegramId = ctx.from.id;
  let user = await User.findOne({ telegramId });

  if (!user) {
    const keypair = Keypair.generate();
    const newWalletAddress = keypair.publicKey.toBase58();

    user = new User({ telegramId, walletAddress: newWalletAddress, transactions: [] });
    await user.save();

    ctx.replyWithMarkdown(`Welcome *${ctx.from.first_name}*!

🚀 We've created a wallet address for you:
\`\`\`
${newWalletAddress}
\`\`\`

You can now use:
/connect - Link your Phantom Wallet
/balance - Check your balance
/addfund - How to fund your wallet
/disconnect - Unlink wallet
/namewallet <name> - Name your wallet
/history - View last 5 transactions
/help - Show all commands`);
  } else {
    ctx.reply('Welcome back! Use /help to see what you can do.');
  }
});

bot.command('help', (ctx) => {
  ctx.replyWithMarkdown(`*Available Commands:*

/start - Join and create a wallet
/connect - Link your Phantom Wallet
/balance - Check your SOL balance
/addfund - How to fund your wallet
/disconnect - Unlink your wallet
/namewallet <name> - Give your wallet a name
/history - Show your last 5 transactions
/help - Show this menu again`);
});

bot.command('connect', (ctx) => {
  const telegramId = ctx.from.id;
  const redirect = `https://phantomwalletbot.onrender.com/wallet-connected?telegramId=${telegramId}`;
  const deeplink = `https://phantom.app/ul/v1/connect?` +
    `app_url=${encodeURIComponent('https://phantomwalletbot.onrender.com')}` +
    `&redirect_link=${encodeURIComponent(redirect)}` +
    `&dapp_encryption_public_key=${DAPP_ENCRYPTION_PUBLIC_KEY}`;

  ctx.reply('Click below to connect your Phantom Wallet:', {
    reply_markup: {
      inline_keyboard: [[{ text: 'Connect Wallet', url: deeplink }]],
    },
  });
});

bot.command('balance', async (ctx) => {
  const telegramId = ctx.from.id;
  const user = await User.findOne({ telegramId });
  if (!user || !user.walletAddress) {
    return ctx.reply('Wallet not found. Use /start or /connect first.');
  }

  try {
    const connection = new Connection(clusterApiUrl('mainnet-beta'), 'confirmed');
    const balance = await connection.getBalance(new PublicKey(user.walletAddress));
    ctx.reply(`Your wallet balance is ${(balance / 1e9).toFixed(5)} SOL`);
  } catch (err) {
    console.error(err);
    ctx.reply('Could not fetch balance. Try again later.');
  }
});

bot.command('namewallet', async (ctx) => {
  const telegramId = ctx.from.id;
  const name = ctx.message.text.split(' ').slice(1).join(' ');

  if (!name) return ctx.reply('Please provide a name like `/namewallet MyVault`');

  await User.findOneAndUpdate({ telegramId }, { walletName: name });
  ctx.reply(`Your wallet is now named "${name}"`);
});

bot.command('history', async (ctx) => {
  const telegramId = ctx.from.id;
  const user = await User.findOne({ telegramId });

  if (!user || !user.walletAddress) return ctx.reply('Wallet not found. Connect first.');

  try {
    const connection = new Connection(clusterApiUrl('mainnet-beta'), 'confirmed');
    const signatures = await connection.getConfirmedSignaturesForAddress2(new PublicKey(user.walletAddress), { limit: 5 });

    if (!signatures.length) return ctx.reply('No recent transactions.');

    const messages = signatures.map((tx, i) => `#${i + 1} → ${tx.signature.substring(0, 20)}...`);
    ctx.replyWithMarkdown(`*Recent Transactions:*

${messages.join('\n')}`);
  } catch (err) {
    console.error(err);
    ctx.reply('Could not fetch transaction history.');
  }
});

bot.command('disconnect', async (ctx) => {
  const telegramId = ctx.from.id;
  await User.findOneAndUpdate({ telegramId }, { walletAddress: null });
  ctx.reply('Your wallet has been disconnected. You can reconnect using /connect.');
});

bot.command('addfund', (ctx) => {
  ctx.replyWithMarkdown(`*How to Fund Your Wallet:*

1. Buy SOL from a crypto exchange (Binance, Coinbase, etc.)
2. Transfer it to your wallet address (shown in /start)
3. Use /balance to confirm it arrived

Always double-check your wallet address!`);
});

// Admin command to list all users
bot.command('adminusers', async (ctx) => {
  if (!ADMIN_IDS.includes(ctx.from.id.toString())) return ctx.reply('You are not authorized.');

  const users = await User.find({});
  if (!users.length) return ctx.reply('No users yet.');

  const summary = users.map(u => `ID: ${u.telegramId}, Wallet: ${u.walletAddress || 'None'}, Name: ${u.walletName || 'Unnamed'}`).join('\n');
  ctx.replyWithMarkdown(`*All Users:*

${summary}`);
});

// === Phantom Callback Route ===
app.get('/wallet-connected', async (req, res) => {
  const { telegramId, phantom_encryption_public_key, nonce, data } = req.query;

  if (!telegramId || !phantom_encryption_public_key || !nonce || !data) {
    return res.send('Missing parameters. Wallet not connected.');
  }

  try {
    const phantomPubKey = bs58.decode(phantom_encryption_public_key);
    const decodedNonce = bs58.decode(nonce);
    const encryptedData = bs58.decode(data);

    const decrypted = nacl.box.open(
      encryptedData,
      decodedNonce,
      phantomPubKey,
      dappKeyPair.secretKey
    );

    if (!decrypted) return res.send('Failed to decrypt data.');

    const { public_key } = JSON.parse(Buffer.from(decrypted).toString('utf8'));

    if (!public_key) return res.send('No public key found.');

    await User.findOneAndUpdate(
      { telegramId },
      { walletAddress: public_key },
      { upsert: true, new: true }
    );

    res.send('Wallet connected! Return to Telegram and use /balance.');
  } catch (err) {
    console.error('Decryption error:', err);
    res.send('Error connecting wallet.');
  }
});

// === Start Servers ===
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
bot.launch().then(() => console.log('Telegram bot running'));

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
