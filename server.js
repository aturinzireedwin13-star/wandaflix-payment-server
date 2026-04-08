const express = require("express");
const axios = require("axios");
const admin = require("firebase-admin");

const app = express();
const PORT = process.env.PORT || 3000;

// 🔐 1. FIREBASE ADMIN SETUP (Secure Method)
try {
    const serviceAccount = process.env.FIREBASE_SERVICE_ACCOUNT 
        ? JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT) 
        : require("./wandaflix-firebase-adminsdk-fbsvc-136831cd7f.json");

    admin.initializeApp({
        credential: admin.credential.cert(serviceAccount)
    });
    console.log("✅ Firebase Admin Initialized");
} catch (error) {
    console.error("❌ Firebase Initialization Error:", error.message);
}

const db = admin.firestore();

// 🔑 PESAPAL CREDENTIALS
const CONSUMER_KEY = process.env.CONSUMER_KEY || "CjmavNhVjPUfzdByvopgp0iWy81L75MM";
const CONSUMER_SECRET = process.env.CONSUMER_SECRET || "jTjD/OOj77qJZJrqqFx8HGfzhLM=";
const IPN_ID = process.env.IPN_ID || "af8de284-55a1-4e81-b00d-da86eb52bdf0";
const baseURL = "https://pay.pesapal.com/v3/api";

// ✅ HELPER: GET TOKEN
async function getToken() {
    const response = await axios.post(`${baseURL}/Auth/RequestToken`, {
        consumer_key: CONSUMER_KEY,
        consumer_secret: CONSUMER_SECRET,
    });
    return response.data.token;
}

// 💳 THE PAY ROUTE
app.get("/pay", async (req, res) => {
    try {
        const { amount, plan, userId, email } = req.query;

        if (!userId) return res.status(400).send("User ID is required to process payment.");

        const token = await getToken();

        const orderData = {
            id: `WANDA-${Date.now()}`, 
            currency: "UGX",
            amount: parseFloat(amount || 1000), 
            description: `Wandaflix ${plan || 'Daily'} Plan`,
            callback_url: "https://wandaflix-payment-server.onrender.com/ipn", 
            notification_id: IPN_ID,
            billing_address: {
                email_address: email || "customer@wandaflix.com",
                first_name: userId, // We store the UID here to find it in the IPN
                last_name: "User"
            }
        };

        const response = await axios.post(`${baseURL}/Transactions/SubmitOrderRequest`, orderData, {
            headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }
        });

        if (response.data.redirect_url) {
            res.redirect(response.data.redirect_url);
        } else {
            res.status(400).json(response.data);
        }
    } catch (err) {
        console.error("PAYMENT ERROR:", err.response?.data || err.message);
        res.status(500).send("Unable to initiate payment.");
    }
});

// 🔔 IPN LISTENER: This unlocks the movie in Firebase
app.get("/ipn", async (req, res) => {
    const { OrderTrackingId, OrderMerchantReference } = req.query;

    try {
        const token = await getToken();
        
        // Check actual status from Pesapal
        const statusRes = await axios.get(
            `${baseURL}/Transactions/GetTransactionStatus?orderTrackingId=${OrderTrackingId}`,
            { headers: { Authorization: `Bearer ${token}` } }
        );

        const paymentStatus = statusRes.data.payment_status_description;
        const userId = statusRes.data.billing_address.first_name; // Getting UID back
        const planDescription = statusRes.data.description;

        if (paymentStatus === "Completed") {
            // Determine days to add based on plan name
            let days = 1;
            if (planDescription.includes("Weekly")) days = 7;
            if (planDescription.includes("Monthly")) days = 30;

            const expiryDate = new Date();
            expiryDate.setDate(expiryDate.getDate() + days);

            // 🔓 UPDATE FIREBASE
            await db.collection("users").doc(userId).update({
                isPremium: true,
                plan: planDescription,
                expiryDate: admin.firestore.Timestamp.fromDate(expiryDate)
            });

            console.log(`✅ Success: Unlocked ${planDescription} for User ${userId}`);
        }

        res.json({ status: 200 });
    } catch (err) {
        console.error("IPN ERROR:", err.message);
        res.status(500).send("IPN Processing Failed");
    }
});

app.listen(PORT, () => console.log(`🚀 Wandaflix Server Running on Port ${PORT}`));
