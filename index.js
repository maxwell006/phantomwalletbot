const { Telegraf } = require("telegraf");
const { Connection, PublicKey, clusterApiUrl } = require("@solana/web3.js");
const express = require("express");
const dotenv = require("dotenv");
const User = require("./models/User");
const bs58 = require('bs58');


const mongoDBConnection = require("./config/mongodb");

dotenv.config();
const app = express();
const bot = new Telegraf(process.env.BOT_TOKEN);
const PORT = process.env.PORT;

// Making a MongoDB connection here
mongoDBConnection();

// bot.command("start", asy)
// Connect my Wallet Command here
bot.command("connect", (ctx) => {
  const telegramId = ctx.from.id;
  const callbackUrl = `http://phantomwalletbot.onrender.com/wallet-connected?telegramId=${telegramId}`;
  const deeplink = `https://phantom.app/ul/v1/connect?app_url=https://phantomwalletbot.onrender.com&redirect_link=https://phantomwalletbot.onrender.com/wallet-connected?telegramId=${telegramId}`;
//   const deeplink = `https://phantom.app/ul/v1/connect?app_url=https://mobilegigo.com&redirect_link=${encodeURIComponent(
//     callbackUrl
//   )}`;

  ctx.reply("Click below to connect your Phantom Wallet:", {
    reply_markup: {
      inline_keyboard: [[{ text: "Connect Wallet", url: deeplink }]],
    },
  });
});

// The Wallet Connect Callback (called by Phantom after wallet a successful connection)
// app.get("/wallet-connected", async (req, res) => {
//   const { telegramId, public_key } = req.query;
//   if (!telegramId || !public_key) return res.send("Error connecting wallet");

//   try {
//     await User.findOneAndUpdate(
//       { telegramId },
//       { walletAddress: public_key },
//       { upsert: true, new: true }
//     );
//     res.send(
//       "Wallet connected successfully! You can return to Telegram and use /balance"
//     );
//   } catch (err) {
//     res.send("Error saving wallet to database");
//     console.log(err);
//   }
// });

app.get('/wallet-connected', async (req, res) => {
  const { d, telegramId, errorCode, errorMessage } = req.query;

  if (errorCode) {
    return res.send(`Phantom Error: ${decodeURIComponent(errorMessage)}`);
  }

  if (!d || !telegramId) {
    return res.send('Missing required parameters');
  }

  try {
    // Decode base64-encoded string
    const decoded = JSON.parse(Buffer.from(d, 'base64').toString());

    const publicKey = decoded.public_key;

    if (!publicKey) return res.send('No public key returned from Phantom');

    await User.findOneAndUpdate(
      { telegramId },
      { walletAddress: publicKey },
      { upsert: true, new: true }
    );

    res.send('✅ Wallet connected successfully! You can return to Telegram and use /balance');
  } catch (err) {
    console.error('Error parsing Phantom redirect:', err);
    res.send('An error occurred while connecting wallet.');
  }
});

// The Wallet Balance Command here
bot.command("balance", async (ctx) => {
  const telegramId = ctx.from.id;

  try {
    const user = await User.findOne({ telegramId });
    if (!user || !user.walletAddress) {
      return ctx.reply("Please connect your wallet first using /connect");
    }

    const connection = new Connection(clusterApiUrl("mainnet-beta"));
    const balance = await connection.getBalance(
      new PublicKey(user.walletAddress)
    );
    const sol = balance / 1e9;
    ctx.reply(`Your balance is ${sol} SOL`);
  } catch (err) {
    ctx.reply("Error fetching balance");

    console.log("Error fetching balance: ", err);
  }
});

// Start express server here
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server listening on port:${PORT}`);
});

// Launching Telegram bot here
bot.launch();

// Graceful shutdown process here
process.once("SIGINT", () => bot.stop("SIGINT"));
process.once("SIGTERM", () => bot.stop("SIGTERM"));
