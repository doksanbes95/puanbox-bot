const express = require('express');
const { Telegraf, Markup } = require('telegraf');
const mongoose = require('mongoose');

const BOT_TOKEN = process.env.BOT_TOKEN;
const MONGO_URI = process.env.MONGO_URI;
const PORT = process.env.PORT || 3000;

if (!BOT_TOKEN || !MONGO_URI) {
  console.error('HATA: BOT_TOKEN veya MONGO_URI eksik!');
  process.exit(1);
}

// ------------------------------------
// 1. WEB SUNUCUSU VE MINI APP EKRANI
// ------------------------------------
const app = express();

const htmlPage = `
<!DOCTYPE html>
<html lang="tr">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>PuanBox Mini App</title>
  <script src="https://telegram.org/js/telegram-web-app.js"></script>
  <script src="https://adsgram.ai/js/adsgram-ad-sdk.js"></script>
  <style>
    body {
      background-color: #1c1c1e;
      color: #ffffff;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      height: 100vh;
      margin: 0;
      padding: 20px;
      box-sizing: border-box;
    }
    .card {
      background-color: #2c2c2e;
      border-radius: 16px;
      padding: 24px;
      text-align: center;
      box-shadow: 0 4px 12px rgba(0,0,0,0.3);
      width: 100%;
      max-width: 350px;
    }
    h1 { margin-top: 0; font-size: 22px; color: #34c759; }
    p { color: #aeaeb2; font-size: 14px; }
    .btn {
      background-color: #007aff;
      color: white;
      border: none;
      padding: 16px 20px;
      border-radius: 12px;
      font-size: 16px;
      font-weight: bold;
      width: 100%;
      margin-top: 20px;
      cursor: pointer;
    }
    .btn:active { opacity: 0.8; }
  </style>
</head>
<body>
  <div class="card">
    <h1>🎁 PuanBox Kazan</h1>
    <p>Reklam izleyerek anında PB bakiyesi kazanabilirsin.</p>
    <button class="btn" onclick="showRewardAd()">🎬 Reklam İzle (Puan Kazan)</button>
  </div>

  <script>
    if (window.Telegram && window.Telegram.WebApp) {
      window.Telegram.WebApp.ready();
      window.Telegram.WebApp.expand();
    }

    function showRewardAd() {
      if (window.Adsgram) {
        const AdController = window.Adsgram.init({ blockId: "38592" });

        AdController.show().then((result) => {
          alert("🎉 Tebrikler! Reklamı başarıyla izlediniz.");
        }).catch((result) => {
          console.log("Reklam tamamlanamadı veya kapatıldı:", result);
        });
      } else {
        alert("⚠️ Adsgram yükleniyor, lütfen 3 saniye sonra tekrar deneyin.");
      }
    }
  </script>
</body>
</html>
`;

// Mini App adresleri çağrıldığında HTML sayfasını gönder
app.get('/', (req, res) => res.send(htmlPage));
app.get('/index.html', (req, res) => res.send(htmlPage));

app.listen(PORT, () => {
  console.log(`🌐 Web Sunucusu ${PORT} portunda çalışıyor.`);
});

// ------------------------------------
// 2. MONGO DB VE TELEGRAM BOTU
// ------------------------------------
const bot = new Telegraf(BOT_TOKEN);

mongoose.connect(MONGO_URI, { serverSelectionTimeoutMS: 5000 })
  .then(() => console.log('✅ MongoDB Bağlantısı Başarılı!'))
  .catch(err => console.error('❌ MongoDB Bağlantı Hatası:', err.message));

const UserSchema = new mongoose.Schema({
  telegramId: { type: String, unique: true },
  username: String,
  pbBalance: { type: Number, default: 0 },
  dailyAdCount: { type: Number, default: 0 },
  referrerId: String,
  lastBonusDate: Date
});

const User = mongoose.model('User', UserSchema);

bot.start(async (ctx) => {
  try {
    if (mongoose.connection.readyState !== 1) {
      return ctx.reply('⚠️ Veritabanı bağlantısı kuruluyor, lütfen 5 saniye sonra tekrar deneyin.');
    }

    const telegramId = ctx.from.id.toString();
    const username = ctx.from.username || ctx.from.first_name || 'Kullanıcı';
    const startParam = ctx.startPayload;

    let user = await User.findOne({ telegramId });

    if (!user) {
      user = new User({
        telegramId,
        username,
        referrerId: startParam && startParam !== telegramId ? startParam : null
      });

      if (user.referrerId) {
        const isPremium = ctx.from.is_premium;
        const reward = isPremium ? 3000 : 1000;
        await User.findOneAndUpdate({ telegramId: user.referrerId }, { $inc: { pbBalance: reward } });
        user.pbBalance += 500;
      }
      await user.save();
    }

    const welcomeText = `🎁 *PuanBox Bot'a Hoş Geldin!*\n\n` +
      `👤 *Kullanıcı:* @${username}\n` +
      `💰 *PB Bakiyen:* \`${user.pbBalance.toLocaleString()} PB\`\n` +
      `📺 *Günlük Reklam Hakkı:* \`${user.dailyAdCount} / 50\`\n\n` +
      `Kazanmaya başlamak için aşağıdaki butonları kullan!`;

    return ctx.replyWithMarkdown(welcomeText, Markup.inlineKeyboard([
      [Markup.button.webApp('🚀 Uygulamayı Aç (Reklam İzle)', 'https://puanbox-bot.onrender.com')],
      [Markup.button.callback('📅 Günlük Bonus (+100 PB)', 'daily_bonus')],
      [Markup.button.callback('🎡 Şans Çarkı', 'spin_wheel')],
      [Markup.button.callback('👥 Arkadaşını Davet Et', 'referral')],
      [Markup.button.callback('💎 Airdrop / Çekim (Kilitli)', 'withdraw')]
    ]));
  } catch (err) {
    console.error('Start Komutu Hatası:', err);
    ctx.reply('Bir hata oluştu, lütfen tekrar deneyin.');
  }
});

bot.action('daily_bonus', async (ctx) => {
  try {
    const telegramId = ctx.from.id.toString();
    const user = await User.findOne({ telegramId });
    const now = new Date();

    if (user && user.lastBonusDate && (now - user.lastBonusDate) < 24 * 60 * 60 * 1000) {
      return ctx.answerCbQuery('⚠️ Günlük bonusunu zaten aldın! 24 saat sonra tekrar gel.', { show_alert: true });
    }

    if (user) {
      user.pbBalance += 100;
      user.lastBonusDate = now;
      await user.save();
    }

    ctx.answerCbQuery('🎉 Tebrikler! +100 PB Bakiyene Eklendi.', { show_alert: true });
  } catch (err) {
    console.error('Bonus Hatası:', err);
  }
});

bot.action('referral', async (ctx) => {
  try {
    const refLink = `https://t.me/PuanBoxBot?start=${ctx.from.id}`;
    const text = `👥 *Arkadaşını Davet Et & PB Kazan!*\n\n` +
      `Davet ettiğin her arkadaşın için *1.000 PB* (Premium üye ise *3.000 PB*) kazanırsın!\n\n` +
      `🔗 *Senin Özel Davet Linkin:*\n\`${refLink}\``;
    
    await ctx.replyWithMarkdown(text);
    await ctx.answerCbQuery();
  } catch (err) {
    console.error('Ref Hatası:', err);
  }
});

bot.launch()
  .then(() => console.log('🚀 PuanBox Botu Aktif ve Dinliyor!'))
  .catch(err => console.error('Bot Başlatma Hatası:', err));

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
