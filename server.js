const express = require("express");
const axios = require("axios");
const admin = require("firebase-admin");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());

/* =========================
   🔐 FIREBASE SETUP
========================= */
let serviceAccount;

if (process.env.FIREBASE_SERVICE_ACCOUNT) {
  serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
  console.log("🌍 Firebase ENV loaded");
} else {
  try {
    serviceAccount = require("./wandaflix-firebase-adminsdk-fbsvc-136831cd7f.json");
    console.log("💻 Firebase local file loaded");
  } catch (e) {
    console.error("❌ Firebase error:", e.message);
  }
}

if (serviceAccount) {
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
  });
  console.log("✅ Firebase initialized");
}

const db = admin.firestore();

/* =========================
   🔑 PESAPAL CONFIG
========================= */
const consumer_key = "YOUR_CONSUMER_KEY";
const consumer_secret = "YOUR_CONSUMER_SECRET";
const baseURL = "https://pay.pesapal.com/v3/api";
const IPN_ID = "6608a16d-e037-401a-ab56-da8551e1e515";

/* =========================
   🔑 GET TOKEN
========================= */
async function getToken() {
  const res = await axios.post(`${baseURL}/Auth/RequestToken`, {
    consumer_key,
    consumer_secret,
  });
  return res.data.token;
}

/* =========================
   🏠 HOME
========================= */
app.get("/", (req, res) => {
  res.send("🚀 Wandaflix Payment Server Running");
});

/* =========================
   💳 START PAYMENT
========================= */
app.get("/pay", async (req, res) => {
  try {
    const plan = (req.query.plan || "").toLowerCase();
    const userId = req.query.userId;
    const email = req.query.email || null;

    if (!userId) return res.status(400).send("Missing userId");

    let amount = 0;

    if (plan === "daily") amount = 1000;
    else if (plan === "weekly") amount = 5000;
    else if (plan === "monthly") amount = 18000;
    else return res.status(400).send("Invalid plan");

    // 🔥 SAVE PENDING PAYMENT
    await db.collection("pendingPayments").doc(userId).set({
      userId,
      email,
      plan,
      amount,
      status: "PENDING",
      createdAt: new Date().toISOString()
    });

    const token = await getToken();

    const response = await axios.post(
      `${baseURL}/Transactions/SubmitOrderRequest`,
      {
        id: Date.now().toString(),
        merchant_reference: userId,
        currency: "UGX",
        amount: amount,
        description: `Wandaflix ${plan} subscription`,
        callback_url: "https://wandaflix-payment-server.onrender.com/callback",
        notification_id: IPN_ID,
        billing_address: {
          email_address: email || "user@email.com",
          phone_number: "0700000000",
          country_code: "UG",
          first_name: "Wanda",
          last_name: "User",
        },
      },
      {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      }
    );

    return res.json({
      redirect_url: response.data.redirect_url,
    });

  } catch (err) {
    console.error("❌ PAYMENT ERROR:", err.response?.data || err.message);
    return res.status(500).send("Payment error");
  }
});

/* =========================
   🔥 IPN (UNLOCK SYSTEM)
========================= */
app.get("/ipn", async (req, res) => {
  console.log("🔥 IPN RECEIVED:", req.query);

  try {
    const orderTrackingId = req.query.OrderTrackingId;
    const userId = req.query.OrderMerchantReference;

    if (!userId) return res.status(400).send("Missing userId");

    const token = await getToken();

    const statusRes = await axios.get(
      `${baseURL}/Transactions/GetTransactionStatus?orderTrackingId=${orderTrackingId}`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      }
    );

    const paymentStatus = statusRes.data.payment_status_description;

    console.log("💰 PAYMENT STATUS:", paymentStatus);

    if (paymentStatus === "Completed") {

      const paymentDoc = await db.collection("pendingPayments").doc(userId).get();

      const plan = paymentDoc.exists ? paymentDoc.data().plan : "daily";
      const email = paymentDoc.exists ? paymentDoc.data().email : null;

      const now = new Date();
      let expiry = new Date();

      if (plan === "daily") expiry.setDate(expiry.getDate() + 1);
      if (plan === "weekly") expiry.setDate(expiry.getDate() + 7);
      if (plan === "monthly") expiry.setMonth(expiry.getMonth() + 1);

      // 🔥 UPDATE USER (FINAL FIX)
      await db.collection("users").doc(userId).set({
        email: email,
        isSubscribed: true,
        subscription: {
          active: true,
          plan: plan,
          startDate: now.toISOString(),
          expiryDate: expiry.toISOString()
        }
      }, { merge: true });

      console.log(`✅ USER UNLOCKED: ${userId}`);

      // 🧹 CLEAN UP
      await db.collection("pendingPayments").doc(userId).delete().catch(() => {});
    }

    return res.send("IPN processed");

  } catch (err) {
    console.error("❌ IPN ERROR:", err.response?.data || err.message);
    return res.status(500).send("IPN error");
  }
});

/* =========================
   🔁 CALLBACK
========================= */
app.get("/callback", (req, res) => {
  console.log("Callback:", req.query);
  res.send("✅ Payment complete. Return to app.");
});

/* =========================
   🚀 START SERVER
========================= */
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});
