const express = require("express");
const axios = require("axios");
const admin = require("firebase-admin");

const app = express();
const PORT = process.env.PORT || 3000;

// 🔐 FIREBASE SETUP
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

// 🔑 PESAPAL CONFIG
const consumer_key = "CjmavNhVjPUfzdByvopgp0iWy81L75MM";
const consumer_secret = "jTjD/OOj77qJZJrqqFx8HGfzhLM=";
const baseURL = "https://pay.pesapal.com/v3/api";

// 🔔 YOUR REAL IPN ID (ALREADY SET ✅)
const IPN_ID = "6608a16d-e037-401a-ab56-da8551e1e515";

// 🔑 GET TOKEN
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
    const plan = (req.query.plan || "").toLowerCase();
    const userId = req.query.userId;

    if (!userId) return res.status(400).send("Missing userId");

    let amount = 0;

    if (plan === "daily") amount = 1000;
    else if (plan === "weekly") amount = 5000;
    else if (plan === "monthly") amount = 18000;
    else return res.status(400).send("Invalid plan");

    // 🔥 SAVE PLAN BEFORE PAYMENT
    await db.collection("pendingPayments").doc(userId).set({
      plan,
      amount,
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


// 🔔 IPN (FINAL WORKING VERSION)
app.get("/ipn", async (req, res) => {
  console.log("🔥 IPN RECEIVED:", req.query);

  try {
    const orderTrackingId = req.query.OrderTrackingId;
    const userId = req.query.OrderMerchantReference;

    if (!userId) return res.status(400).send("Missing userId");

    const token = await getToken();

    const statusResponse = await axios.get(
      `${baseURL}/Transactions/GetTransactionStatus?orderTrackingId=${orderTrackingId}`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      }
    );

    const paymentStatus = statusResponse.data.payment_status_description;

    console.log("💰 PAYMENT STATUS:", paymentStatus);

    if (paymentStatus === "Completed") {

      // 🔥 GET PLAN FROM FIRESTORE
      const paymentDoc = await db.collection("pendingPayments").doc(userId).get();

      let plan = "daily";

      if (paymentDoc.exists) {
        plan = paymentDoc.data().plan;
      }

      let expiry = new Date();

      if (plan === "daily") expiry.setDate(expiry.getDate() + 1);
      if (plan === "weekly") expiry.setDate(expiry.getDate() + 7);
      if (plan === "monthly") expiry.setMonth(expiry.getMonth() + 1);

      await db.collection("users").doc(userId).set({
        subscription: {
          active: true,
          plan: plan,
          startDate: new Date().toISOString(),
          expiryDate: expiry.toISOString(),
        },
        unlockedMovies: true,
      }, { merge: true });

      console.log(`✅ ${userId} unlocked (${plan})`);
    }

    res.send("IPN processed");

  } catch (err) {
    console.error("❌ IPN ERROR:", err.response?.data || err.message);
    res.status(500).send("IPN error");
  }
});


// 🔁 CALLBACK
app.get("/callback", (req, res) => {
  console.log("Callback:", req.query);
  res.send("✅ Payment complete. Return to app.");
});


// 🚀 START SERVER
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});
