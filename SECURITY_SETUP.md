# ⚠️ ADMIN SECURITY SETUP — پہلے یہ کریں / DO THIS FIRST

آپ نے کہا کوئی آپ کی فائلیں کاپی کر کے آپ کے Firebase میں notification set کر چکا ہے۔ اس کی وجہ یہ تھی کہ **admin.html میں کوئی password نہیں تھا، اور Firebase Database کے rules بھی کسی کو بھی لکھنے کی اجازت دے رہے تھے۔**

اب دونوں چیزیں fix ہو چکی ہیں کوڈ میں، لیکن **3 چیزیں آپ کو خود Firebase Console میں manually کرنی ہوں گی** — یہ کوڈ سے نہیں ہو سکتیں:

---

## Step 1: Firebase میں Admin Account بنائیں

1. [Firebase Console](https://console.firebase.google.com/) کھولیں → اپنا project (`minexustv-a23ba`) منتخب کریں
2. Left sidebar میں **Authentication** → **Users** tab کھولیں
3. **Add User** پر click کریں
4. اپنا email اور ایک مضبوط password ڈالیں (یہ آپ کا admin panel login ہوگا)
5. یاد رکھیں: یہ email/password آپ کے admin panel (`/admin`) میں login کرنے کے لیے استعمال ہوگا

## Step 2: اس User کو Admin کے طور پر Register کریں

1. اسی Firebase Console میں **Realtime Database** کھولیں
2. سب سے اوپر root پر ایک نیا node بنائیں: `admins`
3. اس کے اندر، اپنا **User UID** (جو Step 1 میں Authentication → Users میں نظر آئے گا) بطور key ڈالیں، اور value `true` رکھیں

مثال:
```json
{
  "admins": {
    "AbCdEfGhIjKlMnOpQrStUvWxYz12": true
  }
}
```

بغیر اس step کے، آپ login تو کر پائیں گے لیکن admin panel نہیں کھلے گا (یہ جان بوجھ کر ہے — صرف password کافی نہیں، uid کو admins میں ہونا لازمی ہے)۔

## Step 3: Database Rules Publish کریں

1. Realtime Database → **Rules** tab کھولیں
2. اس repo میں شامل `database.rules.json` کا پورا content copy کریں
3. اسے Firebase Console کے Rules editor میں paste کر کے **Publish** کریں

یہی اصل حفاظت ہے — یہ rules اب کسی کو بھی (چاہے وہ آپ کی websites کی files copy کر لے) آپ کے database میں لکھنے سے روک دیں گے، جب تک وہ آپ کا verified admin account نہ ہو۔ چاہے کوئی آپ کی `index.html`/`admin.html` copy کر کے اپنی website بنا لے، وہ آپ کے database میں کچھ نہیں لکھ سکے گا۔

**⚠️ اہم: اگر آپ نے پہلے یہ rules publish کی تھیں تو دوبارہ publish کریں** — اس version میں `leaderboard` اور `users` rules میں بگ فکس ہوئی ہے (leaderboard خالی دکھ رہا تھا اور admin panel میں users کا ڈیٹا صحیح نہیں آ رہا تھا)۔ پرانی rules کے ساتھ یہ مسئلے جاری رہیں گے۔

## Step 4: Google Sign-In کے لیے Authorized Domain

اگر آپ کے app میں "Sign in with Google" کام نہیں کر رہا:

1. Firebase Console → **Authentication** → **Settings** tab → **Authorized domains** کھولیں
2. چیک کریں کہ `minexustv.vercel.app` (یا آپ کا اصل domain) اس list میں موجود ہے
3. اگر نہیں ہے تو **Add domain** پر click کر کے شامل کریں
4. یہ بھی چیک کریں: Authentication → **Sign-in method** میں **Google** provider **Enabled** ہونا چاہیے (بند ہو تو on کریں)

## Step 5: Analytics کے لیے Anonymous Sign-In Enable کریں (نیا — v4)

Public Analytics (Admin Panel → Analytics tab میں traffic, clicks, graphs) کام کرنے کے لیے یہ ضروری ہے:

1. Firebase Console → **Authentication** → **Sign-in method** کھولیں
2. **Anonymous** provider تلاش کریں اور اسے **Enable** کریں
3. یہ ہر visitor (چاہے وہ login نہ کرے) کو ایک silent, بغیر پاسورڈ کے, بغیر کسی ذاتی معلومات کے session دیتا ہے — صرف اس لیے کہ analytics events لکھے جا سکیں (database.rules.json میں `auth !== null` درکار ہے)
4. یہ enable نہ کیا تو باقی app بالکل نارمل چلے گی، صرف Analytics tab میں کوئی traffic نظر نہیں آئے گا

---

1. `/admin` کھولیں — اب ایک login screen نظر آئے گی (پہلے سیدھا dashboard کھلتا تھا)
2. Step 1 والا email/password ڈال کر sign in کریں
3. اگر admin panel کھل جائے — سب صحیح ہے ✅
4. اگر "This account does not have admin access" آئے — Step 2 دوبارہ چیک کریں (uid صحیح ہے یا نہیں)
5. اگر "Could not verify admin access" کوئی error code کے ساتھ آئے — Step 3 دوبارہ چیک کریں (rules publish ہوئیں یا نہیں)

## Step 6: Real Push Notifications (نیا — v7) — فون پر notification آنے کے لیے

پہلے صرف ایک in-app banner تھا (صرف اس وقت نظر آتا جب کوئی پہلے سے website کھولے بیٹھا ہو)۔ اب اصل push notification سسٹم شامل ہے — فون بند/لاک ہونے پر بھی notification آئے گی، بالکل native app کی طرح۔ اسے فعال کرنے کے لیے **دو الگ چیزیں** چاہئیں:

### 6a. VAPID Key (public — یہ فون کو token لینے دیتی ہے)

1. [Firebase Console](https://console.firebase.google.com/) → اپنا project → **Project Settings** (⚙️ icon) → **Cloud Messaging** tab کھولیں
2. **Web configuration** کے نیچے، **Web Push certificates** میں **Generate key pair** پر click کریں
3. جو key نظر آئے اسے کاپی کریں
4. `index.html` میں تلاش کریں: `const VAPID_KEY = 'REPLACE_WITH_YOUR_FIREBASE_VAPID_KEY';`
5. `REPLACE_WITH_YOUR_FIREBASE_VAPID_KEY` کی جگہ اپنی اصل key paste کریں

⚠️ یہ key **public** ہے — یہ صرف یہ ثابت کرتی ہے کہ کون سا app token مانگ رہا ہے، اس سے کوئی notification نہیں بھیجی جا سکتی، اس لیے یہ کوڈ میں رکھنا محفوظ ہے۔

### 6b. Service Account Key (secret — یہ سرور کو notification بھیجنے دیتی ہے)

یہ وہ اصل چابی ہے جو دراصل notification بھیجتی ہے — یہ **کبھی بھی** کوڈ میں نہیں رکھنی، صرف Vercel کی secret settings میں:

1. Firebase Console → **Project Settings** → **Service Accounts** tab
2. **Generate new private key** پر click کریں — ایک `.json` file ڈاؤن لوڈ ہوگی
3. وہ پوری file ایک text editor میں کھولیں، اور *پورا content* (پوری JSON، شروع سے آخر تک) کاپی کریں
4. [Vercel Dashboard](https://vercel.com/) → آپ کا project → **Settings** → **Environment Variables** کھولیں
5. ایک نیا variable بنائیں:
   - Name: `FCM_SERVICE_ACCOUNT_JSON`
   - Value: وہ پوری JSON جو آپ نے کاپی کی (ایک ہی لائن میں paste کر دیں، Vercel خود سنبھال لے گا)
6. **Save** کریں، پھر project کو دوبارہ **Deploy** کریں (نیا environment variable صرف نئے deployment پر لاگو ہوتا ہے)

### 6c. Database Rule اپڈیٹ

`database.rules.json` میں `fcmTokens` کا نیا section شامل ہو چکا ہے کوڈ میں — Step 3 کی طرح، یہ پوری updated file دوبارہ Firebase Console → Realtime Database → Rules میں paste کر کے **Publish** کریں۔

### ٹیسٹ کیسے کریں

1. Website کھولیں → Account → Settings → **Push Notifications** toggle آن کریں (پہلی بار browser خود permission مانگے گا — Allow کریں)
2. Admin Panel → **Push Notifications** میں جا کر ایک notification بھیجیں
3. اگر سب صحیح سیٹ اپ ہے تو ٹوسٹ میں "📲 Pushed to 1 device(s)" جیسا کچھ نظر آئے گا، اور آپ کے فون/براؤزر پر اصل notification آئے گی — چاہے آپ نے website کا ٹیب بند کر دیا ہو

اگر "FCM_SERVICE_ACCOUNT_JSON is not configured" کا error آئے — Step 6b دوبارہ چیک کریں (Vercel میں environment variable صحیح سے سیٹ ہوا اور نیا deploy ہوا یا نہیں)۔

## Step 7: Automatic New-Release Notifications (نیا — v7)

اب ایک نیا cron job ہر روز خود بخود چیک کرتا ہے کہ کوئی نئی movie release ہوئی یا نہیں — اگر ہوئی تو تمام users کو خود ہی push notification چلی جاتی ہے، آپ کو manually notification بھیجنے کی ضرورت نہیں۔ یہ صرف ایک environment variable سیٹ کرنے سے فعال ہوتا ہے:

1. [Vercel Dashboard](https://vercel.com/) → آپ کا project → **Settings** → **Environment Variables**
2. ایک نیا variable بنائیں:
   - Name: `CRON_SECRET`
   - Value: کوئی بھی لمبی random string (مثلاً کسی password generator سے 32 حروف کی string بنا لیں)
3. **Save** کریں، پھر project دوبارہ **Deploy** کریں

بس — اس کے بعد Vercel خود ہر روز ایک بار (تقریباً رات 8 بجے پاکستان ٹائم) `/api/cron-check-releases` کو call کرے گا، جو TMDB سے نئی releases چیک کر کے خود بخود notification بھیج دے گا۔ یہ صرف اُن movies کے لیے چلتا ہے جن کی notification پہلے کبھی نہیں بھیجی گئی، تو ایک movie پر دو بار notification نہیں آئے گی۔

⚠️ Vercel کے مفت (Hobby) plan پر cron جابز دن میں صرف ایک بار چل سکتی ہیں — یہ اسی حساب سے سیٹ ہے۔ اگر آپ Vercel Pro پر ہیں تو `vercel.json` میں `schedule` بدل کر زیادہ بار چلا سکتے ہیں۔

## Password بھول جائیں تو؟

`/admin-recover.html` پر جائیں، اپنا email ڈالیں — Firebase آپ کو password reset link بھیج دے گا۔

عام صارفین (app کے اندر، admin نہیں) کے لیے بھی یہی سہولت موجود ہے — Login screen پر "Forgot your password?" لنک پر tap کریں۔

## Leaderboard میں صرف اپنی entry نظر آ رہی ہے؟

یہ 99% اس وجہ سے ہوتا ہے کہ **`database.rules.json` ابھی تک Firebase Console میں publish نہیں ہوئی** (یا پرانا version ابھی تک active ہے)۔ کیسے چیک کریں:

1. اپنی website کھولیں، سائن ان کریں، browser کا **Console** کھولیں (F12 → Console tab)
2. اگر وہاں یہ error نظر آئے: `Failed to sync leaderboard entry — check that database.rules.json is published...` تو یہ confirm ہے کہ rules publish نہیں ہوئیں
3. Firebase Console → Realtime Database → **Rules** میں جائیں، اس repo کی `database.rules.json` کا پورا content دوبارہ paste کر کے **Publish** کریں
4. Admin Panel → Registered Users tab → **"Sync All Users to Leaderboard"** پر click کریں — یہ پرانے/موجودہ سب users کو ایک ساتھ leaderboard میں شامل کر دے گا

## اہم نوٹ

- یہ admin email/password کبھی بھی کسی اور کو نہ بتائیں
- ایک سے زیادہ admins چاہئیں تو ہر ایک کے لیے Step 1 اور 2 دہرائیں (ہر ایک کی اپنی uid ہوگی)
- `/admin` search engines میں index نہیں ہوگا (robots.txt اور noindex header دونوں لگے ہیں), لیکن URL خود secret نہیں ہے — اصل حفاظت password اور database rules سے آتی ہے، نہ کہ URL چھپانے سے
