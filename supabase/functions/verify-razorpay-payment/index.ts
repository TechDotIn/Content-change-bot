import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface VerifyPaymentRequest {
  razorpay_order_id?: string;
  razorpay_payment_id?: string;
  razorpay_signature?: string;
  payment_link_id?: string;
  razorpay_payment_link_id?: string;
  plan_id?: "plan_599" | "plan_799" | "plan_1499" | string;
  user_id?: string;
}

const PLAN_NAMES: Record<string, { name: string; price: number }> = {
  plan_599: { name: "Basic Plan (₹599)", price: 599 },
  plan_799: { name: "Pro Plan (₹799)", price: 799 },
  plan_1499: { name: "AI Translation & Multi-Channel Plan (₹1499)", price: 1499 },
};

// Native Web Crypto API HMAC SHA-256
async function computeHmacSha256Hex(secret: string, message: string): Promise<string> {
  const encoder = new TextEncoder();
  const keyData = encoder.encode(secret);
  const msgData = encoder.encode(message);

  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    keyData,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );

  const signatureBuffer = await crypto.subtle.sign(
    "HMAC",
    cryptoKey,
    msgData
  );

  return Array.from(new Uint8Array(signatureBuffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const keyId = Deno.env.get("RAZORPAY_KEY_ID");
    const keySecret = Deno.env.get("RAZORPAY_KEY_SECRET");
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    if (!keySecret) {
      return new Response(
        JSON.stringify({ error: "RAZORPAY_KEY_SECRET is not configured in environment variables." }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const payload = (await req.json()) as VerifyPaymentRequest;
    const {
      razorpay_order_id,
      razorpay_payment_id,
      razorpay_signature,
      payment_link_id,
      razorpay_payment_link_id,
      user_id,
    } = payload;

    const plinkId = (payment_link_id || razorpay_payment_link_id || "").trim();

    // Extract Bearer token to identify user
    const authHeader = req.headers.get("Authorization");
    let resolvedUserId: string | null = null;

    if (supabaseUrl && supabaseServiceKey) {
      const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);
      if (authHeader) {
        const token = authHeader.replace("Bearer ", "").trim();
        if (token) {
          try {
            const { data: { user } } = await supabaseAdmin.auth.getUser(token);
            if (user) {
              resolvedUserId = user.id;
            }
          } catch (e) {
            console.warn("Token verification fallback notice:", e);
          }
        }
      }
    }

    const targetUserId = resolvedUserId || user_id;

    if (!targetUserId) {
      return new Response(
        JSON.stringify({ error: "Target User ID could not be resolved from auth token or request body." }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    let detectedPlanId = (payload.plan_id || "").toLowerCase().trim();
    let paymentVerified = false;
    let finalPaymentId = razorpay_payment_id || "";

    // CASE 1: Razorpay Payment Link Verification
    if (plinkId) {
      if (!keyId) {
        return new Response(
          JSON.stringify({ error: "RAZORPAY_KEY_ID is required to verify payment links." }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const authHeaderRzp = "Basic " + btoa(`${keyId}:${keySecret}`);
      const rzpRes = await fetch(`https://api.razorpay.com/v1/payment_links/${plinkId}`, {
        method: "GET",
        headers: {
          Authorization: authHeaderRzp,
          "Content-Type": "application/json",
        },
      });

      if (!rzpRes.ok) {
        const errData = await rzpRes.json().catch(() => ({}));
        return new Response(
          JSON.stringify({ error: errData.error?.description || "Could not query Razorpay payment link status." }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const plinkData = await rzpRes.json();
      if (plinkData.status !== "paid") {
        return new Response(
          JSON.stringify({ error: `Payment link status is '${plinkData.status}', not 'paid'.` }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      paymentVerified = true;
      if (plinkData.notes?.plan_id && !detectedPlanId) {
        detectedPlanId = plinkData.notes.plan_id.toLowerCase().trim();
      }
      if (!finalPaymentId && plinkData.payments && plinkData.payments.length > 0) {
        finalPaymentId = plinkData.payments[0].payment_id || "";
      }
    }
    // CASE 2: Standard Razorpay Order Verification with HMAC Signature
    else if (razorpay_order_id && razorpay_payment_id && razorpay_signature) {
      const signatureBody = `${razorpay_order_id}|${razorpay_payment_id}`;
      const expectedSignature = await computeHmacSha256Hex(keySecret, signatureBody);

      if (expectedSignature !== razorpay_signature) {
        return new Response(
          JSON.stringify({ error: "Invalid Razorpay payment signature! Payment verification failed." }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      paymentVerified = true;
    } else {
      return new Response(
        JSON.stringify({ error: "Missing required payment link ID or standard Razorpay order verification credentials." }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (!paymentVerified) {
      return new Response(
        JSON.stringify({ error: "Payment verification failed." }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (!detectedPlanId || !PLAN_NAMES[detectedPlanId]) {
      detectedPlanId = "plan_599";
    }

    const planInfo = PLAN_NAMES[detectedPlanId];
    const now = new Date();
    const periodEnd = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000); // 30 days

    // Update database subscription record
    if (supabaseUrl && supabaseServiceKey && targetUserId) {
      const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);
      const subRecord = {
        user_id: targetUserId,
        plan_id: detectedPlanId,
        plan_name: planInfo.name,
        amount_paid: planInfo.price,
        status: "active",
        razorpay_order_id: razorpay_order_id || plinkId,
        razorpay_payment_id: finalPaymentId || razorpay_payment_id || `plink_pay_${Date.now()}`,
        current_period_start: now.toISOString(),
        current_period_end: periodEnd.toISOString(),
        updated_at: now.toISOString(),
      };

      const { error: dbError } = await supabaseAdmin
        .from("subscriptions")
        .upsert(subRecord, { onConflict: "user_id" });

      if (dbError) {
        console.error("Database update error:", dbError);
        return new Response(
          JSON.stringify({ error: `Database update failed: ${dbError.message}` }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        message: `🎉 Payment verified! ${planInfo.name} activated successfully.`,
        subscription: {
          user_id: targetUserId,
          plan_id: detectedPlanId,
          plan_name: planInfo.name,
          amount_paid: planInfo.price,
          status: "active",
          razorpay_order_id: razorpay_order_id || plinkId,
          razorpay_payment_id: finalPaymentId || razorpay_payment_id,
          current_period_start: now.toISOString(),
          current_period_end: periodEnd.toISOString(),
        },
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ error: (err as Error).message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
