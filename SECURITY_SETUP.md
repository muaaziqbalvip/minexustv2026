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

---

## کیسے پتا چلے گا کہ سب کام کر گیا؟

1. `/admin` کھولیں — اب ایک login screen نظر آئے گی (پہلے سیدھا dashboard کھلتا تھا)
2. Step 1 والا email/password ڈال کر sign in کریں
3. اگر admin panel کھل جائے — سب صحیح ہے ✅
4. اگر "This account does not have admin access" آئے — Step 2 دوبارہ چیک کریں (uid صحیح ہے یا نہیں)

## Password بھول جائیں تو؟

`/admin-recover.html` پر جائیں، اپنا email ڈالیں — Firebase آپ کو password reset link بھیج دے گا۔

## اہم نوٹ

- یہ admin email/password کبھی بھی کسی اور کو نہ بتائیں
- ایک سے زیادہ admins چاہئیں تو ہر ایک کے لیے Step 1 اور 2 دہرائیں (ہر ایک کی اپنی uid ہوگی)
- `/admin` search engines میں index نہیں ہوگا (robots.txt اور noindex header دونوں لگے ہیں), لیکن URL خود secret نہیں ہے — اصل حفاظت password اور database rules سے آتی ہے، نہ کہ URL چھپانے سے
