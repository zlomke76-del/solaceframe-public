import express from "express";

const app = express();

app.use(express.json());

app.get("/health", (_, res) => {
  res.json({
    status: "ok",
    service: "solaceframe-api"
  });
});

app.post("/generate/image", async (req, res) => {
  const packet = req.body;

  res.json({
    accepted: true,
    packet,
    governance: {
      admissible: true
    }
  });
});

app.listen(4000, () => {
  console.log("SolaceFrame API running on :4000");
});
