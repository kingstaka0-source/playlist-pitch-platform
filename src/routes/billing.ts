import { Router } from "express";
import { prisma } from "../db";
import { stripe, STRIPE_PRICE_ID, FRONTEND_URL } from "../stripe";

export const billing = Router();

function getArtistId(req: any) {
  const headerArtistId =
    typeof req.headers?.["x-artist-id"] === "string"
      ? req.headers["x-artist-id"]
      : "";

  const queryArtistId =
    typeof req.query?.artistId === "string" ? req.query.artistId : "";

  return String(headerArtistId || queryArtistId || "").trim();
}

billing.get("/status", async (req, res) => {
  try {
    const artistId = getArtistId(req);

    if (!artistId) {
      return res.status(400).json({ error: "MISSING_ARTIST_ID" });
    }

    const artist = await prisma.artist.findUnique({
      where: { id: artistId },
      select: {
        id: true,
        name: true,
        email: true,
        plan: true,
        trialUntil: true,
        stripeCustomerId: true,
        stripeSubscriptionId: true,
        subscriptionStatus: true,
        currentPeriodEnd: true,
        cancelAtPeriodEnd: true,
      },
    });

    if (!artist) {
      return res.status(404).json({ error: "ARTIST_NOT_FOUND" });
    }

    return res.json({
      ok: true,
      billing: artist,
    });
  } catch (e: any) {
    console.error("BILLING_STATUS_ERROR", e?.message ?? e);
    return res.status(500).json({
      error: "BILLING_STATUS_FAILED",
      message: e?.message ?? String(e),
    });
  }
});

billing.post("/create-checkout-session", async (req, res) => {
  try {
    const artistId = getArtistId(req);

    if (!artistId) {
      return res.status(400).json({ error: "MISSING_ARTIST_ID" });
    }

    const artist = await prisma.artist.findUnique({
      where: { id: artistId },
      select: {
        id: true,
        email: true,
        name: true,
        stripeCustomerId: true,
      },
    });

    if (!artist) {
      return res.status(404).json({ error: "ARTIST_NOT_FOUND" });
    }

    let customerId = artist.stripeCustomerId || null;

    if (!customerId) {
      const customer = await stripe.customers.create({
        email: artist.email || undefined,
        name: artist.name || undefined,
        metadata: {
          artistId: artist.id,
        },
      });

      customerId = customer.id;

      await prisma.artist.update({
        where: { id: artist.id },
        data: {
          stripeCustomerId: customerId,
        },
      });
    }

    const session = await stripe.checkout.sessions.create({
  mode: "subscription",
  customer: customerId,
  client_reference_id: artist.id,
  line_items: [
    {
      price: STRIPE_PRICE_ID,
      quantity: 1,
    },
  ],
  success_url: `${FRONTEND_URL}/upgrade?success=1`,
  cancel_url: `${FRONTEND_URL}/pricing?canceled=1`,
  allow_promotion_codes: true,
  metadata: {
    artistId: artist.id,
    plan: "PRO",
  },
  subscription_data: {
    trial_period_days: 7,
    metadata: {
      artistId: artist.id,
      plan: "PRO",
    },
  },
});

    return res.json({
      ok: true,
      url: session.url,
      sessionId: session.id,
    });
  } catch (e: any) {
    console.error("CREATE_CHECKOUT_SESSION_ERROR", e?.message ?? e);
    return res.status(500).json({
      error: "CREATE_CHECKOUT_SESSION_FAILED",
      message: e?.message ?? String(e),
    });
  }
});

billing.post("/create-portal-session", async (req, res) => {
  try {
    const artistId = getArtistId(req);

    if (!artistId) {
      return res.status(400).json({ error: "MISSING_ARTIST_ID" });
    }

    const artist = await prisma.artist.findUnique({
      where: { id: artistId },
      select: {
        id: true,
        stripeCustomerId: true,
      },
    });

    if (!artist) {
      return res.status(404).json({ error: "ARTIST_NOT_FOUND" });
    }

    if (!artist.stripeCustomerId) {
      return res.status(400).json({ error: "NO_STRIPE_CUSTOMER" });
    }

    const session = await stripe.billingPortal.sessions.create({
      customer: artist.stripeCustomerId,
      return_url: `${FRONTEND_URL}/upgrade`,
    });

    return res.json({
      ok: true,
      url: session.url,
    });
  } catch (e: any) {
    console.error("CREATE_PORTAL_SESSION_ERROR", e?.message ?? e);
    return res.status(500).json({
      error: "CREATE_PORTAL_SESSION_FAILED",
      message: e?.message ?? String(e),
    });
  }
});

billing.get("/access", async (req, res) => {
  try {
    const artistId = getArtistId(req);

    if (!artistId) {
      return res.status(400).json({ error: "MISSING_ARTIST_ID" });
    }

    const artist = await prisma.artist.findUnique({
      where: { id: artistId },
      select: {
        id: true,
        plan: true,
        trialUntil: true,
        subscriptionStatus: true,
        currentPeriodEnd: true,
        cancelAtPeriodEnd: true,
      },
    });

    if (!artist) {
      return res.status(404).json({ error: "ARTIST_NOT_FOUND" });
    }

    const start = new Date();
    const monthStart = new Date(
      Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), 1, 0, 0, 0)
    );

    const createdThisMonth = await prisma.pitch.count({
      where: {
        createdAt: { gte: monthStart },
        match: {
          track: { artistId },
        },
      },
    });

    const isPaid = artist.plan === "TRIAL" || artist.plan === "PRO";
    const freeLimit = 3;
    const remaining = isPaid ? null : Math.max(0, freeLimit - createdThisMonth);

    return res.json({
      ok: true,
      access: {
        plan: artist.plan,
        isPaid,
        trialUntil: artist.trialUntil,
        subscriptionStatus: artist.subscriptionStatus,
        currentPeriodEnd: artist.currentPeriodEnd,
        cancelAtPeriodEnd: artist.cancelAtPeriodEnd,
        limits: {
          pitchesPerMonth: isPaid ? null : freeLimit,
          createdThisMonth,
          remaining,
        },
        features: {
          canCreatePitch: isPaid ? true : createdThisMonth < freeLimit,
          canLaunchCampaign: isPaid,
          canAutoSend: isPaid,
          canBulkQueue: isPaid,
          canUseUnlimitedPitches: isPaid,
        },
      },
    });
  } catch (e: any) {
    console.error("BILLING_ACCESS_ERROR", e?.message ?? e);
    return res.status(500).json({
      error: "BILLING_ACCESS_FAILED",
      message: e?.message ?? String(e),
    });
  }
});