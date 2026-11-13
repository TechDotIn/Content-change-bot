const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface CreateOrderRequest {
  plan_id: "plan_599" | "plan_799" | "plan_1499";
}

const PLAN_PRICES: Record<string, { amount: number; name: string }> = {
  plan_599: { amount: 59900, name: "Basic Plan (₹599)" },
  plan_799: { amount: 79900, name: "Pro Plan (₹799)" },
  plan_1499: { amount: 149900, name: "AI Translation & Multi-Channel Plan (₹1499)" },
};

Deno.serve(async (req: Request) => {
  // Handle CORS preflight request
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const keyId = Deno.env.get("RAZORPAY_KEY_ID");
    const keySecret = Deno.env.get("RAZORPAY_KEY_SECRET");

    if (!keyId || !keySecret) {
      return new Response(
        JSON.stringify({ error: "Razorpay Key ID or Secret is not configured in environment variables." }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const { plan_id } = (await req.json()) as CreateOrderRequest;

    if (!plan_id || !PLAN_PRICES[plan_id]) {
      return new Response(
        JSON.stringify({ error: "Invalid plan_id specified. Choose 'plan_599', 'plan_799', or 'plan_1499'." }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const planInfo = PLAN_PRICES[plan_id];

    // Call Razorpay API to create hosted payment link (works with live UPI QR on any domain)
    const authHeader = "Basic " + btoa(`${keyId}:${keySecret}`);
    const plinkRes = await fetch("https://api.razorpay.com/v1/payment_links", {
      method: "POST",
      headers: {
        Authorization: authHeader,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        amount: planInfo.amount,
        currency: "INR",
        accept_partial: false,
        description: `${planInfo.name} - TelegramSync Hub`,
        notify: { sms: false, email: false },
        reminder_enable: false,
        notes: {
          plan_id: plan_id,
          plan_name: planInfo.name,
        },
        callback_url: `https://telegram.adshatke.site/?payment=success&plan_id=${plan_id}`,
        callback_method: "get"
      }),
    });

    const plinkData = await plinkRes.json();
    if (plinkRes.ok && plinkData.short_url) {
      return new Response(
        JSON.stringify({
          success: true,
          order_id: plinkData.id,
          payment_url: plinkData.short_url,
          short_url: plinkData.short_url,
          amount: plinkData.amount,
          currency: plinkData.currency,
          key_id: keyId,
          plan_id: plan_id,
          plan_name: planInfo.name,
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Fallback: Standard Orders API
    const razorpayRes = await fetch("https://api.razorpay.com/v1/orders", {
      method: "POST",
      headers: {
        Authorization: authHeader,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        amount: planInfo.amount,
        currency: "INR",
        receipt: `rcpt_${Date.now()}`,
        notes: {
          plan_id: plan_id,
          plan_name: planInfo.name,
        },
      }),
    });

    const razorpayData = await razorpayRes.json();

    if (!razorpayRes.ok) {
      return new Response(
        JSON.stringify({ error: razorpayData.error?.description || "Failed to create order with Razorpay." }),
        { status: razorpayRes.status, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    return new Response(
      JSON.stringify({
        success: true,
        order_id: razorpayData.id,
        amount: razorpayData.amount,
        currency: razorpayData.currency,
        key_id: keyId,
        plan_id: plan_id,
        plan_name: planInfo.name,
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
