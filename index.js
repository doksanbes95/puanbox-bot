const TelegramBot = require('node-telegram-bot-api');
const mongoose = require('mongoose');
const cron = require('node-cron');

// --- CONFIGURATION ---
const BOT_TOKEN = process.env.BOT_TOKEN;
const MONGO_URI = process.env.MONGO_URI;

// REKLAM DIRECT LINK'LERI (Render Environment'tan Çekilir)
const MONETAG_LINK = process.env.MONETAG_LINK || 'https://omg10.com/4/11507575';
const ADSTERRA_LINK = process.env.ADSTERRA_LINK || MONETAG_LINK;

const bot = new TelegramBot(BOT_TOKEN, { polling: true });

// --- DATABASE SCHEMAS ---
mongoose.connect(MONGO_URI)
  .then(() => console.log('MongoDB Bağlantısı Başarılı'))
  .catch(err => console.error('MongoDB Hatası:', err));

const userSchema = new mongoose.Schema({
  telegramId: { type: Number, required: true, unique: true },
  firstName: String,
  username: String,
  pbBalance: { type: Number, default: 100 },
  refCode: String,
  referredBy: Number,
  
  // Mining (Kazım)
  miningStartTime: { type: Date, default: null },

  // Dice (Şans Zarı)
  lastDiceTime: { type: Date, default: null },

  // Raffle (Çekiliş)
  dailyRaffleTickets: { type: Number, default: 0 },
  totalRaffleTickets: { type: Number, default: 0 },

  // Ad Timers
  lastAdRewardTime: { type: Date, default: null }
});

const User = mongoose.model('User', userSchema);

// Aktif otomatik ödül bekleyen kullanıcıların listesi (Spam engellemek için)
const pendingAdRewards = new Set();

// --- GECE 00:00 GÜNLÜK BİLET LİMİTİ SIFIRLAMA ---
cron.schedule('0 0 * * *', async () => {
  await User.updateMany({}, { dailyRaffleTickets: 0 });
  console.log('Günlük çekiliş bilet limitleri sıfırlandı.');
});

// --- ANA MENÜ BUTONLARI ---
function getMainKeyboard() {
  return {
    reply_markup: {
      inline_keyboard: [
        [
          { text: '⛏️ PuanBox Kazım (Mining)', callback_data: 'menu_mining' },
          { text: '🎲 Şans Zarı (4 Saat)', callback_data: 'menu_dice' }
        ],
        [
          { text: '🎟️ Haftalık Çekiliş', callback_data: 'menu_raffle' },
          { text: '📺 Reklam İzle (+100 PB)', callback_data: 'menu_ads' }
        ],
        [
          { text: '💰 Bakiyem & Profil', callback_data: 'menu_profile' },
          { text: '👥 Davet Et & Kazan', callback_data: 'menu_ref' }
        ]
      ]
    }
  };
}

// --- /START KOMUTU ---
bot.onText(/\/start(?:\s+(.+))?/, async (msg, match) => {
  const chatId = msg.chat.id;
  const refPayload = match ? match[1] : null;

  try {
    let user = await User.findOne({ telegramId: chatId });
    
    if (!user) {
      let referredBy = null;
      if (refPayload && !isNaN(refPayload) && parseInt(refPayload) !== chatId) {
        referredBy = parseInt(refPayload);
        await User.findOneAndUpdate(
          { telegramId: referredBy },
          { $inc: { pbBalance: 250 } }
        );
      }

      user = new User({
        telegramId: chatId,
        firstName: msg.from.first_name,
        username: msg.from.username,
        referredBy: referredBy
      });
      await user.save();
    }

    const welcomeMsg = `🎁 **PuanBox'a Hoş Geldin ${msg.from.first_name}!**\n\n` +
      `Sohbet içi kazım yapabilir, zar atarak PB kazanabilir ve reklamlardan bilet toplayarak haftalık büyük çekilişe katılabilirsin.\n\n` +
      `💳 **Mevcut Bakiyen:** \`${user.pbBalance} PB\``;

    bot.sendMessage(chatId, welcomeMsg, { parse_mode: 'Markdown', ...getMainKeyboard() });
  } catch (err) {
    console.error(err);
  }
});

// --- INLINE BUTTON HANDLER ---
bot.on('callback_query', async (query) => {
  const chatId = query.message.chat.id;
  const data = query.data;
  const messageId = query.message.message_id;

  let user = await User.findOne({ telegramId: chatId });
  if (!user) return;

  // --- BAKİYE & PROFİL ---
  if (data === 'menu_profile') {
    const text = `👤 **PuanBox Kullanıcı Profili**\n\n` +
      `🆔 **ID:** \`${user.telegramId}\`\n` +
      `💎 **PB Bakiyesi:** \`${user.pbBalance} PB\`\n` +
      `🎟️ **Haftalık Çekiliş Biletin:** \`${user.totalRaffleTickets} Bilet\``;

    bot.editMessageText(text, {
      chat_id: chatId,
      message_id: messageId,
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: [[{ text: '◀️ Ana Menü', callback_data: 'menu_main' }]]
      }
    });
  }

  // --- ANA MENÜYE DÖNÜŞ ---
  if (data === 'menu_main') {
    bot.editMessageText(`📦 **PuanBox Ana Menü**\n\n💳 Bakiyen: \`${user.pbBalance} PB\``, {
      chat_id: chatId,
      message_id: messageId,
      parse_mode: 'Markdown',
      ...getMainKeyboard()
    });
  }

  // --- MINING (KAZIM) ---
  if (data === 'menu_mining') {
    const now = new Date();
    let text = `⛏️ **PuanBox Mining (Kazım)**\n\n2 Saatlik Kazım süresince arka planda **200 PB** üretilir.\n\n`;
    let keyboard = [];

    if (!user.miningStartTime) {
      text += `Status: 🔴 **Kazım Durduruldu**`;
      keyboard.push([{ text: '▶️ Kazımı Başlat (2 Saat)', callback_data: 'start_mining' }]);
    } else {
      const diffMs = now - new Date(user.miningStartTime);
      const twoHoursMs = 2 * 60 * 60 * 1000;

      if (diffMs >= twoHoursMs) {
        text += `Status: 🟢 **Kazım Tamamlandı! (+200 PB Birikti)**`;
        keyboard.push([{ text: '💰 PB Bakiyeme Aktar (+200 PB)', callback_data: 'claim_mining' }]);
      } else {
        const remainingMinutes = Math.ceil((twoHoursMs - diffMs) / (1000 * 60));
        text += `Status: ⚡ **Kazım Devam Ediyor...**\n⏱️ Kalan Süre: **${remainingMinutes} Dakika**`;
        keyboard.push([{ text: '🔄 Sayfayı Yenile', callback_data: 'menu_mining' }]);
      }
    }

    keyboard.push([{ text: '◀️ Ana Menü', callback_data: 'menu_main' }]);

    bot.editMessageText(text, {
      chat_id: chatId,
      message_id: messageId,
      parse_mode: 'Markdown',
      reply_markup: { inline_keyboard: keyboard }
    });
  }

  if (data === 'start_mining') {
    user.miningStartTime = new Date();
    await user.save();
    bot.answerCallbackQuery(query.id, { text: '⛏️ Kazım Başlatıldı!' });
    bot.emit('callback_query', { ...query, data: 'menu_mining' });
  }

  if (data === 'claim_mining') {
    user.pbBalance += 200;
    user.miningStartTime = null;
    await user.save();
    bot.answerCallbackQuery(query.id, { text: '🎉 +200 PB Hesabına Eklendi!' });
    bot.emit('callback_query', { ...query, data: 'menu_mining' });
  }

  // --- DICE (ŞANS ZARI) ---
  if (data === 'menu_dice') {
    const now = new Date();
    const fourHoursMs = 4 * 60 * 60 * 1000;
    let canRoll = true;
    let remainingMinutes = 0;

    if (user.lastDiceTime) {
      const diffMs = now - new Date(user.lastDiceTime);
      if (diffMs < fourHoursMs) {
        canRoll = false;
        remainingMinutes = Math.ceil((fourHoursMs - diffMs) / (1000 * 60));
      }
    }

    if (canRoll) {
      const roll = Math.floor(Math.random() * 6) + 1;
      let reward = 50;
      if (roll === 3 || roll === 4) reward = 100;
      if (roll === 5) reward = 250;
      if (roll === 6) reward = 500;

      user.pbBalance += reward;
      user.lastDiceTime = now;
      await user.save();

      const diceText = `🎲 **Zar Atıldı! Gelen Sayı: [ ${roll} ]**\n\n🎉 Tebrikler! **+${reward} PB** kazandın!\nYeni zar hakkı 4 saat sonra tanımlanacak.`;
      bot.editMessageText(diceText, {
        chat_id: chatId,
        message_id: messageId,
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [
            [{ text: '📺 Reklam İzle', url: MONETAG_LINK }],
            [{ text: '◀️ Ana Menü', callback_data: 'menu_main' }]
          ]
        }
      });
    } else {
      const waitText = `⏳ **Zar Hakkın Henüz Dolmadı!**\n\nYeni zar atabilmek için **${remainingMinutes} dakika** beklemelisin.`;
      bot.editMessageText(waitText, {
        chat_id: chatId,
        message_id: messageId,
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [
            [{ text: '⚡ Reklam İzle', url: MONETAG_LINK }],
            [{ text: '🔄 Kontrol Et', callback_data: 'menu_dice' }],
            [{ text: '◀️ Ana Menü', callback_data: 'menu_main' }]
          ]
        }
      });
    }
  }

  // --- HAFTALIK ÇEKİLİŞ ---
  if (data === 'menu_raffle') {
    let raffleText = `🎟️ **PuanBox Haftalık Büyük Çekiliş**\n\n` +
      `🏆 **Ödül:** 25.000 PB\n` +
      `🎫 **Senin Toplam Biletin:** \`${user.totalRaffleTickets}\`\n` +
      `📊 **Bugün Aldığın Bilet:** \`${user.dailyRaffleTickets} / 5\`\n\n` +
      `*Aşağıdaki reklam butonuna basıp linki açtığında biletin 10 saniye sonra **otomatik** hesabına tanımlanacaktır (Günde Max 5 Bilet).*`;

    let keyboard = [];
    if (user.dailyRaffleTickets < 5) {
      keyboard.push([{ text: '🎟️ Reklam İzle & Bilet Kazan', callback_data: 'auto_raffle_ad' }]);
    } else {
      raffleText += `\n\n✅ **Bugünkü 5 bilet limitine ulaştın! Yarın tekrar gel.**`;
    }

    keyboard.push([{ text: '◀️ Ana Menü', callback_data: 'menu_main' }]);

    bot.editMessageText(raffleText, {
      chat_id: chatId,
      message_id: messageId,
      parse_mode: 'Markdown',
      reply_markup: { inline_keyboard: keyboard }
    });
  }

  // --- OTOMATİK BİLET SİSTEMİ ---
  if (data === 'auto_raffle_ad') {
    if (pendingAdRewards.has(chatId)) {
      return bot.answerCallbackQuery(query.id, { text: '⏳ Zaten devam eden bir reklam işleminiz var. Lütfen bekleyin.', show_alert: true });
    }

    if (user.dailyRaffleTickets >= 5) {
      return bot.answerCallbackQuery(query.id, { text: '⚠️ Bugünkü bilet limitine ulaştınız.', show_alert: true });
    }

    pendingAdRewards.add(chatId);
    bot.answerCallbackQuery(query.id, { text: '🔗 Reklam açılıyor, 10 saniye sonra biletiniz otomatik eklenecektir!' });

    // Kullanıcıya reklam linkini gönder
    bot.sendMessage(chatId, `👉 Reklamı görüntülemek için tıklayın:\n${MONETAG_LINK}\n\n⏳ *10 saniye sonra biletiniz otomatik tanımlanacaktır...*`, { parse_mode: 'Markdown' });

    // 10 Saniye Sonra Otomatik Bakiyeyi Ver
    setTimeout(async () => {
      try {
        let u = await User.findOne({ telegramId: chatId });
        if (u && u.dailyRaffleTickets < 5) {
          u.dailyRaffleTickets += 1;
          u.totalRaffleTickets += 1;
          u.pbBalance += 50;
          await u.save();

          bot.sendMessage(chatId, `🎉 **Tebrikler!** Reklam izleme doğrulandı.\n🎫 **+1 Çekiliş Bileti** ve **+50 PB** hesabınıza otomatik yüklendi!`, {
            reply_markup: {
              inline_keyboard: [[{ text: '🎟️ Çekiliş Sayfasına Dön', callback_data: 'menu_raffle' }]]
            }
          });
        }
      } catch (err) {
        console.error(err);
      } finally {
        pendingAdRewards.delete(chatId);
      }
    }, 10000); // 10000 ms = 10 saniye
  }

  // --- REKLAM İZLE - KAZAN (OTOMATİK PUAN) ---
  if (data === 'menu_ads') {
    const adsText = `📺 **PuanBox İzle - Kazan**\n\n` +
      `Aşağıdaki reklama tıkladıktan 10 saniye sonra **+100 PB** hesabına **otomatik** aktarılacaktır!\n\n` +
      `*1 Saat arayla yeni reklam izleyebilirsin.*`;

    bot.editMessageText(adsText, {
      chat_id: chatId,
      message_id: messageId,
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: [
          [{ text: '📺 Reklama Tıkla & Kazan (+100 PB)', callback_data: 'auto_claim_ad' }],
          [{ text: '◀️ Ana Menü', callback_data: 'menu_main' }]
        ]
      }
    });
  }

  if (data === 'auto_claim_ad') {
    const now = new Date();

    if (pendingAdRewards.has(chatId)) {
      return bot.answerCallbackQuery(query.id, { text: '⏳ Zaten işlemde olan bir reklamınız var. Lütfen 10 saniye bekleyin.', show_alert: true });
    }

    // 1 Saatlik Cooldown kontrolü
    if (user.lastAdRewardTime) {
      const diffMs = now - new Date(user.lastAdRewardTime);
      const oneHourMs = 60 * 60 * 1000;
      if (diffMs < oneHourMs) {
        const remainingMinutes = Math.ceil((oneHourMs - diffMs) / (1000 * 60));
        return bot.answerCallbackQuery(query.id, { text: `⏳ Yeni reklam izlemek için ${remainingMinutes} dakika beklemelisin.`, show_alert: true });
      }
    }

    pendingAdRewards.add(chatId);
    bot.answerCallbackQuery(query.id, { text: '🔗 Reklam açılıyor! Ödülünüz 10 saniye sonra otomatik yüklenecektir.' });

    // Kullanıcıya reklam linkini gönder
    bot.sendMessage(chatId, `👉 Reklam sayfasını açmak için tıklayın:\n${MONETAG_LINK}\n\n⏳ *10 saniye sonra +100 PB hesabınıza aktarılacaktır...*`, { parse_mode: 'Markdown' });

    // 10 Saniye Sonra Otomatik Bakiyeyi Ver
    setTimeout(async () => {
      try {
        let u = await User.findOne({ telegramId: chatId });
        if (u) {
          u.pbBalance += 100;
          u.lastAdRewardTime = new Date();
          await u.save();

          bot.sendMessage(chatId, `🎉 **Tebrikler!** Reklam izleme tamamlandı.\n💰 **+100 PB** hesabınıza otomatik yüklendi!`, {
            reply_markup: {
              inline_keyboard: [[{ text: '💰 Bakiyemi Gör', callback_data: 'menu_profile' }]]
            }
          });
        }
      } catch (err) {
        console.error(err);
      } finally {
        pendingAdRewards.delete(chatId);
      }
    }, 10000); // 10 saniye
  }

  // --- REFERANS SİSTEMİ ---
  if (data === 'menu_ref') {
    const refLink = `https://t.me/PuanBoxBot?start=${chatId}`;
    const refText = `👥 **PuanBox Referans Programı**\n\n` +
      `Arkadaşlarını davet et, her gelen arkadaşın için **+250 PB** kazan!\n\n` +
      `🔗 **Senin Özel Davet Linkin:**\n\`${refLink}\``;

    bot.editMessageText(refText, {
      chat_id: chatId,
      message_id: messageId,
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: [[{ text: '◀️ Ana Menü', callback_data: 'menu_main' }]]
      }
    });
  }
});
