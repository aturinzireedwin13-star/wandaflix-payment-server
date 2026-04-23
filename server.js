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
  serviceAccount = require("./wandaflix-firebase-adminsdk.json");
  console.log("💻 Firebase local file loaded");
}

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

const db = admin.firestore();

/* =========================
   🔑 PESAPAL CONFIG
========================= */
const consumer_key = "CjmavNhVjPUfzdByvopgp0iWy81L75MM";
const consumer_secret = "jTjD/OOj77qJZJrqqFx8HGfzhLM=";
const baseURL = "https://pay.pesapal.com/v3/api";
const IPN_ID = "6608a16d-e037-401a-ab56-da8551e1e515";

/* =========================
   🔑 GET TOKEN
========================= */
async function getToken() {
  const response = await axios.post(`${baseURL}/Auth/RequestToken`, {
    consumer_key,
    consumer_secret,
  });
  return response.data.token;
}

/* =========================
   🔗 ANDROID APP LINKS FIX
   (THIS IS WHAT GOOGLE NEEDS)
========================= */
app.get("/.well-known/assetlinks.json", (req, res) => {
  res.setHeader("Content-Type", "application/json");

  res.status(200).send([
    {
      relation: ["delegate_permission/common.handle_all_urls"],
      target: {
        namespace: "android_app",
        package_name: "com.wandaflix.app",
        sha256_cert_fingerprints: [
          "42:3C:D4:44:B9:89:71:0E:FB:6D:FE:77:FE:5D:80:2F:97:82:11:72:27:74:F5:4C:E9:51:D9:82:EF:B1:2F:6D"
        ]
      }
    }
  ]);
});

/* =========================
   🏠 HOME
========================= */
app.get("/", (req, res) => {
  res.send("🚀 Wandaflix Payment Server Running");
});

/* =========================
   ✅ CHECK SUBSCRIPTION
========================= */
app.get("/check-subscription", async (req, res) => {
  try {
    const uid = req.query.uid;

    if (!uid) {
      return res.status(400).json({ isPremium: false });
    }

    const doc = await db.collection("subscriptions").doc(uid).get();

    if (!doc.exists) {
      return res.json({ isPremium: false, expired: true });
    }

    const data = doc.data();

    const now = new Date();
    const expiry = new Date(data.expiryDate);

    if (expiry < now) {
      await db.collection("subscriptions").doc(uid).set({
        ...data,
        isPremium: false,
      });

      await db.collection("users").doc(uid).set({
        isSubscribed: false,
        unlockedMovies: false,
      }, { merge: true });

      return res.json({
        isPremium: false,
        expired: true,
      });
    }

    return res.json({
      isPremium: true,
      expired: false,
    });

  } catch (err) {
    console.error("❌ CHECK ERROR:", err.message);
    res.status(500).json({ isPremium: false });
  }
});

/* =========================
   💳 START PAYMENT
========================= */
app.get("/pay", async (req, res) => {
  try {
    const plan = (req.query.plan || "").toLowerCase();
    const uid = req.query.uid;
    const email = req.query.email;

    if (!uid || !email) {
      return res.status(400).send("Missing uid or email");
    }

    let amount = 0;
    if (plan === "daily") amount = 1000;
    else if (plan === "weekly") amount = 5000;
    else if (plan === "monthly") amount = 18000;
    else return res.status(400).send("Invalid plan");

    await db.collection("pendingPayments").doc(uid).set({
      uid,
      email,
      plan,
      amount,
      status: "PENDING",
      createdAt: new Date().toISOString(),
    });

    const token = await getToken();
    const orderId = `WANDA_${uid}_${Date.now()}`;

    const response = await axios.post(
      `${baseURL}/Transactions/SubmitOrderRequest`,
      {
        id: orderId,
        currency: "UGX",
        amount,
        description: `Wandaflix ${plan} subscription`,
        callback_url: "https://wandaflix-payment-server.onrender.com/callback",
        notification_id: IPN_ID,
        merchant_reference: orderId,
        redirect_mode: "TOP_WINDOW",
        billing_address: {
          email_address: email,
          phone_number: "256700000000",
          country_code: "UG",
          first_name: "Wanda",
          last_name: "User",
        },
      },
      {
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
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

/* =========================
   🔥 IPN (PAYMENT CONFIRMATION)
========================= */
app.get("/ipn", async (req, res) => {
  try {
    const orderTrackingId = req.query.OrderTrackingId;
    let merchantRef = req.query.OrderMerchantReference;

    if (!merchantRef) return res.send("Missing reference");

    let uid = merchantRef;
    if (merchantRef.startsWith("WANDA_")) {
      const parts = merchantRef.split("_");
      uid = parts[1];
    }

    const token = await getToken();

    const statusResponse = await axios.get(
      `${baseURL}/Transactions/GetTransactionStatus?orderTrackingId=${orderTrackingId}`,
      {
        headers: { Authorization: `Bearer ${token}` },
      }
    );

    const status = statusResponse.data.payment_status_description;

    if (status === "Completed") {
      const paymentDoc = await db.collection("pendingPayments").doc(uid).get();

      let plan = "daily";
      let email = "";

      if (paymentDoc.exists) {
        plan = paymentDoc.data().plan;
        email = paymentDoc.data().email || "";
      }

      const now = new Date();
      let expiry = new Date();

      if (plan === "daily") expiry.setDate(expiry.getDate() + 1);
      if (plan === "weekly") expiry.setDate(expiry.getDate() + 7);
      if (plan === "monthly") expiry.setMonth(expiry.getMonth() + 1);

      const subscriptionData = {
        uid,
        email,
        isPremium: true,
        plan,
        startDate: now.toISOString(),
        expiryDate: expiry.toISOString(),
      };

      await db.collection("subscriptions").doc(uid).set(subscriptionData);

      await db.collection("users").doc(uid).set({
        isSubscribed: true,
        unlockedMovies: true,
        subscription: subscriptionData,
      }, { merge: true });

      await db.collection("pendingPayments").doc(uid).delete().catch(() => {});
    }

    res.send("OK");

  } catch (err) {
    console.error("❌ IPN ERROR:", err.message);
    res.status(500).send("IPN error");
  }
});

/* =========================
   🔁 CALLBACK
========================= */
app.get("/callback", (req, res) => {
  res.send("✅ Payment complete. Return to app.");
});

/* =========================
   🚀 START SERVER
========================= */
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});
