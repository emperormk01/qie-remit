import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import type { InvoiceRow, UserRow } from "./db";

// Generate a receipt PDF as bytes (Worker-safe, pdf-lib is pure JS).
export async function generateReceiptPdf(inv: InvoiceRow, creator: UserRow | null): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const mono = await doc.embedFont(StandardFonts.Courier);
  const page = doc.addPage([595, 842]); // A4
  const { width, height } = page.getSize();
  const ink = rgb(0.07, 0.07, 0.09);
  const mut = rgb(0.45, 0.45, 0.5);
  const accent = rgb(0.18, 0.52, 0.92);
  const green = rgb(0.16, 0.6, 0.32);
  const paid = inv.status === "paid";
  let y = height - 70;

  const left = 56;
  const draw = (text: string, size = 11, f = font, color = ink, gap = 18) => {
    page.drawText(text, { x: left, y, size, font: f, color });
    y -= gap;
  };

  // Header
  page.drawText("QIE Remit", { x: left, y, size: 22, font: bold, color: accent });
  page.drawText("Payment Receipt", { x: width - 200, y, size: 12, font, color: mut });
  y -= 36;
  page.drawLine({ start: { x: left, y: y + 6 }, end: { x: width - left, y: y + 6 }, thickness: 1, color: rgb(0.9, 0.9, 0.92) });
  draw(`Invoice ${inv.id}`, 16, bold, ink, 28);

  // Amount
  page.drawText(`${inv.amount}`, { x: left, y, size: 36, font: bold, color: ink });
  const amtW = bold.widthOfTextAtSize(`${inv.amount}`, 36);
  page.drawText(inv.currency, { x: left + amtW + 10, y: y + 4, size: 16, font, color: mut });
  y -= 30;
  page.drawText(paid ? "PAID" : "PENDING", { x: left, y, size: 12, font: bold, color: paid ? green : rgb(0.8, 0.3, 0.2) });
  y -= 30;

  const k = (label: string, value: string) => {
    page.drawText(label, { x: left, y, size: 10, font, color: mut });
    page.drawText(value, { x: left + 180, y, size: 10, font: mono, color: ink });
    y -= 20;
  };

  k("Status", paid ? "Paid" : "Pending");
  k("Description", (inv.description || "—").slice(0, 48));
  k("Merchant", (creator?.pass_name || creator?.username || "—").slice(0, 32));
  k("Merchant address", inv.creator_address || "—");
  if (inv.payer_address) k("Paid by", inv.payer_address);
  k("Paid at", inv.paid_at ? new Date(inv.paid_at).toUTCString() : "—");
  k("On-chain invoice #", String(inv.on_chain_id));
  if (inv.pay_tx) {
    page.drawText("Tx hash", { x: left, y, size: 10, font, color: mut });
    const tx = inv.pay_tx.length > 40 ? `${inv.pay_tx.slice(0, 18)}…${inv.pay_tx.slice(-10)}` : inv.pay_tx;
    page.drawText(tx, { x: left + 180, y, size: 10, font: mono, color: accent });
    y -= 20;
  }

  y -= 14;
  page.drawLine({ start: { x: left, y: y + 6 }, end: { x: width - left, y: y + 6 }, thickness: 1, color: rgb(0.9, 0.9, 0.92) });
  y -= 24;
  page.drawText("Settled on QIE Blockchain · Identity attested on-chain", { x: left, y, size: 9, font, color: mut });
  page.drawText(new Date().toISOString().slice(0, 10), { x: width - 120, y, size: 9, font, color: mut });

  return doc.save();
}

// Upload a PDF to Telegram and return its file_id so the bot can send it by id.
export async function uploadPdfToTelegram(
  env: { TELEGRAM_BOT_TOKEN: string },
  chatId: number,
  bytes: Uint8Array,
  filename: string,
  caption: string
): Promise<string | null> {
  const token = env.TELEGRAM_BOT_TOKEN;
  const form = new FormData();
  form.append("chat_id", String(chatId));
  const blob = new Blob([bytes], { type: "application/pdf" });
  form.append("document", blob, filename);
  form.append("caption", caption);
  const res = await fetch(`https://api.telegram.org/bot${token}/sendDocument`, { method: "POST", body: form });
  const data: any = await res.json();
  return data?.ok ? data.result?.document?.file_id ?? null : null;
}
