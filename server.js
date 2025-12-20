const express = require("express");
const cors = require("cors");
const bodyParser = require("body-parser");
const twilio = require("twilio");

const app = express();
app.use(cors({ origin: "*" }));
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: false }));

// ENV VARIABLES (SET ON RENDER)
const {
  TWILIO_ACCOUNT_SID,
  TWILIO_AUTH_TOKEN,
  TWILIO_NUMBER,
  CITYWIDE_API_KEY
} = process.env;

const client = twilio(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN);

// 🔐 SIMPLE PROVIDER LIST (MVP)
const PROVIDERS = [
  { name: "Provider A", phone: "+14108166818", state: "MD", service: "Locksmith" },
  { name: "Provider B", phone: "+13015555555", state: "MD", service: "Locksmith" }
];

let activeLeads = {}; // in-memory MVP

function makeLeadId() {
  return "lead_" + Date.now();
}

// HEALTH CHECK
app.get("/health", (req, res) => {
  res.json({ status: "ok" });
});

// 🟢 CUSTOMER → SERVER
app.post("/lead/new", (req, res) => {
  if (req.headers["x-api-key"] !== CITYWIDE_API_KEY) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const { customerPhone, serviceType, state, notes } = req.body;

  if (!customerPhone || !serviceType || !state) {
    return res.status(400).json({ error: "Missing fields" });
  }

  const leadId = makeLeadId();

  const matches = PROVIDERS.filter(
    p => p.state === state && p.service === serviceType
  );

  activeLeads[leadId] = {
    leadId,
    customerPhone,
    serviceType,
    state,
    notes,
    matches,
    index: 0
  };

  sendToNextProvider(leadId);
  res.json({ success: true, leadId });
});

// 🔁 ROUTING LOGIC (ANGI STYLE)
async function sendToNextProvider(leadId) {
  const lead = activeLeads[leadId];
  if (!lead) return;

  if (lead.index >= lead.matches.length) return;

  const provider = lead.matches[lead.index];

  await client.messages.create({
    from: TWILIO_NUMBER,
    to: provider.phone,
    body:
`🚨 NEW ${lead.serviceType} LEAD (${lead.state})

Customer Phone: ${lead.customerPhone}
Notes: ${lead.notes || "None"}

Reply YES ${leadId} to accept`
  });

  lead.currentProvider = provider.phone;
}

// 📲 PROVIDER REPLIES
app.post("/twilio/sms", (req, res) => {
  const from = req.body.From;
  const body = req.body.Body.trim().toUpperCase();

  const parts = body.split(" ");
  if (parts[0] !== "YES") return res.send("<Response></Response>");

  const leadId = parts[1];
  const lead = activeLeads[leadId];
  if (!lead || lead.currentProvider !== from) {
    return res.send("<Response></Response>");
  }

  // ACCEPTED
  delete activeLeads[leadId];

  res.type("text/xml").send(`
<Response>
<Message>✅ Lead accepted. Customer phone: ${lead.customerPhone}</Message>
</Response>
`);
});

// START SERVER
const PORT = process.env.PORT || 5050;
app.listen(PORT, () => console.log("Server running on", PORT));
