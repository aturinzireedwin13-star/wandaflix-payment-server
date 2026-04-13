app.get("/check-subscription", async (req, res) => {
  try {
    const uid = req.query.uid;

    if (!uid) return res.status(400).json({ isPremium: false });

    const doc = await db.collection("subscriptions").doc(uid).get();

    if (!doc.exists) {
      return res.json({ isPremium: false, expired: true });
    }

    const data = doc.data();

    const now = new Date();
    const expiry = new Date(data.expiryDate);

    // 🔥 AUTO EXPIRE
    if (expiry < now) {
      await db.collection("subscriptions").doc(uid).update({
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
