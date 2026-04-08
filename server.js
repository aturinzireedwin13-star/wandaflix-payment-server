const express = require("express");
const axios = require("axios");
const admin = require("firebase-admin");

const app = express();
const PORT = process.env.PORT || 3000;

// 🔐 FIREBASE SETUP (Render + Local)
let serviceAccount;

if (process.env.FIREBASE_SERVICE_ACCOUNT) {
  serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
  console.log("🌍 Using Firebase ENV");
} else {
  try {
    serviceAccount = require("./wandaflix-firebase-adminsdk-fbsvc-136831cd7f.json");
    console.log("💻 Using local Firebase file");
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

// 🔑 PESAPAL KEYS
const consumer_key = "CjmavNhVjPUfzdByvopgp0iWy81L75MM";
const consumer_secret = "jTjD/OOj77qJZJrqqFx8HGfzhLM=";
const baseURL = "https://pay.pesapal.com/v3/api";

// 🔔 YOUR IPN ID
const IPN_ID = "af8de284-55a1-4e81-b00d-da86eb52bdf0";

// ✅ GET TOKEN
async function getToken() {
  const response = await axios.post(`${baseURL}/Auth/RequestToken`, {
    consumer_key,
    consumer_secret,
  });
  return response.data.token;
}

// 🏠 HOME
app.get("/", (req, res) => {
  res.send("🚀 Wandaflix Payment Server Live");
});

// 💳 PAYMENT ROUTE
app.get("/pay", async (req, res) => {
  try {
    const { plan, userId } = req.query;

    if (!plan || !["daily", "weekly", "monthly"].includes(plan)) {
      return res.status(400).send("Invalid plan");
    }

    if (!userId) {
      return res.status(400).send("Missing userId");
    }

    let amount;
    if (plan === "daily") amount = 1000;
    if (plan === "weekly") amount = 5000;
    if (plan === "monthly") amount = 18000;

    const token = await getToken();

    const response = await axios.post(
      `${baseURL}/Transactions/SubmitOrderRequest`,
      {
        id: Date.now().toString(),

        // 🔥 LINK USER
        merchant_reference: userId,

        currency: "UGX",
        amount,
        description: `Wandaflix ${plan} subscription`,

        // 🔗 USE YOUR REAL DOMAIN
        callback_url: "https://wandaflix-payment-server.onrender.com/callback",

        notification_id: IPN_ID,

        // 🔥 PASS PLAN
        metadata: {
          plan: plan,
        },

        billing_address: {
          email_address: "user@email.com",
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

    res.json({
      redirect_url: response.data.redirect_url,
    });

  } catch (err) {
    console.error("❌ PAYMENT ERROR:", err.response?.data || err.message);
    res.status(500).send("Payment error");
  }
});

// 🔔 IPN (THIS UNLOCKS USERS)
app.get("/ipn", async (req, res) => {
  console.log("🔥 IPN RECEIVED:", req.query);

  try {
    const { merchant_reference, status } = req.query;

    if (!merchant_reference) {
      return res.status(400).send("Missing userId");
    }

    const userRef = db.collection("users").doc(merchant_reference);

    if (status === "COMPLETED") {

      const plan = req.query.plan || "daily";

      let expiry = new Date();

      if (plan === "daily") expiry.setDate(expiry.getDate() + 1);
      if (plan === "weekly") expiry.setDate(expiry.getDate() + 7);
      if (plan === "monthly") expiry.setMonth(expiry.getMonth() + 1);

      await userRef.set({
        subscription: {
          active: true,
          plan: plan,
          startDate: new Date().toISOString(),
          expiryDate: expiry.toISOString(),
        },
        unlockedMovies: true,
      }, { merge: true });

      console.log(`✅ ${merchant_reference} unlocked (${plan})`);

    } else {
      await userRef.set({
        subscription: {
          active: false,
        },
      }, { merge: true });

      console.log(`❌ Payment failed for ${merchant_reference}`);
    }

    res.send("IPN processed");

  } catch (err) {
    console.error("❌ IPN ERROR:", err);
    res.status(500).send("IPN error");
  }
});

// 🔁 CALLBACK
app.get("/callback", (req, res) => {
  console.log("Callback:", req.query);
  res.send("✅ Payment complete. Return to Wandaflix.");
});

// 🚀 START SERVER
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});
