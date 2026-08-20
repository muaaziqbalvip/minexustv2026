# MINEXUS TV — Vercel Deployment Package 🚀

یہ فولڈر خاص طور پر **Vercel** پر براہِ راست اپلوڈ کرنے کے لیے تیار کیا گیا ہے۔

## 🆕 Version 3 — کیا نیا ہے؟

- **Calendar & News:** حقیقی وقت کا ڈیٹا (TMDB سے) — نئی ریلیز، آنے والی فلمیں، اور "نیوز" جو trending/now-playing/upcoming ڈیٹا سے خودکار بنتی ہے
- **بگ فکس:** "Coming Soon" ٹیب پہلے تقریباً خالی رہتا تھا (ابھی ریلیز نہ ہونے والی فلموں کی IMDb ID نہیں ہوتی، جس کی وجہ سے وہ فلٹر ہو جاتی تھیں) — اب صحیح طریقے سے دکھتی ہیں
- **بگ فکس:** News کارڈز پر کلک کرنے سے خراب/خالی پلیئر کھلتا تھا — اب صحیح فلمیں چلتی ہیں
- **Header میں Calendar & News:** اب یہ top navigation میں نمایاں جگہ پر ہے (Account اب بھی top-right اور mobile bottom bar سے قابل رسائی ہے)
- **Guest Access:** اب سائن ان کیے بغیر بھی موویز/سیریز دیکھی جا سکتی ہیں
- **Forgot Password:** عام صارفین کے لیے بھی (پہلے صرف admin کے لیے تھا)
- **Terms/Privacy:** نیا اکاؤنٹ بناتے وقت اب Accept کرنا لازمی ہے، اور links پورے app میں موجود ہیں
- **Memory leak فکس:** لمبی session میں app کی رفتار برقرار رہے گی
- **Offline detection:** انٹرنیٹ نہ ہونے پر واضح banner دکھتا ہے
- **Admin Panel:** password-protected login, leaderboard sync button, developer page، اور custom servers کا مکمل نظام

## 📂 اس فولڈر کے اندر فائلز:
1. `index.html` — مکمل موویز، سیریز، لائیو ٹی وی، اور یوزر اکاؤنٹ سسٹم۔
2. `admin.html` — ایڈمن کنٹرول پینل (M3U لائیو پلے لسٹ امپورٹر + یوزرز لسٹ + لیڈر بورڈ کے ساتھ)۔
3. `vercel.json` — Vercel کے تمام نیٹ ورک، راؤٹنگ اور CORS رولز۔
4. `database.rules.json` — Firebase سیکیورٹی rules (Firebase Console میں manually publish کرنا ضروری ہے — دیکھیں SECURITY_SETUP.md)۔
5. `SECURITY_SETUP.md` — Admin panel، leaderboard، اور Google login سیٹ اپ کرنے کی مکمل گائیڈ۔

---

## ⚡ Vercel پر لائیو کرنے کا طریقہ (Only 2 Steps):

1. **[vercel.com](https://vercel.com)** پر جائیں اور لاگ ان کریں۔
2. **"Add New Project"** پر کلک کریں اور اس `vercel-deploy` فولڈر (یا GitHub ریپوزٹری) کو سلیکٹ کر کے **Deploy** دبا دیں۔
3. آپ کی ایپ **`https://minexustv.vercel.app`** پر سیکنڈز میں لائیو ہو جائے گی!

* ایڈمن پینل کھولنے کے لیے: `https://minexustv.vercel.app/admin`
* **⚠️ Deploy کرنے کے بعد `SECURITY_SETUP.md` ضرور پڑھیں** — admin account بنانا اور database rules publish کرنا manual steps ہیں جو کوڈ سے نہیں ہو سکتے۔
