import formidable from "formidable";
import fs from "fs";
import xlsx from "xlsx";
import { Configuration, OpenAIApi } from "openai";
import { parse } from "csv-parse/sync";
import path from "path";
import { createRequire } from "module";
import { fileURLToPath } from "url";

const require = createRequire(import.meta.url);
const { default: translate } = await import("translate-google");

export const config = {
  api: {
    bodyParser: false
  }
};

const openai = new OpenAIApi(new Configuration({
  apiKey: process.env.OPENAI_API_KEY
}));

// 相似度計算
function similarity(a, b) {
  const longer = a.length > b.length ? a : b;
  const shorter = a.length > b.length ? b : a;
  const same = longer.split('').filter((c, i) => shorter[i] === c).length;
  return same / longer.length;
}

// 品號產生邏輯
function generateCode(name) {
  const cleaned = name.replace(/[^\w\s\-]/g, '').replace(/\s+/g, ' ');
  const initials = cleaned.split(' ').map(word => /^[一-龥]+$/.test(word) ? '' : word[0].toUpperCase()).join('');
  return initials.substring(0, 16).toUpperCase();
}

export default async function handler(req, res) {
  const form = formidable({ multiples: true, uploadDir: "/tmp", keepExtensions: true });

  form.parse(req, async (err, fields, files) => {
    if (err) return res.status(500).json({ error: "Upload error" });

    const vendor = fields.vendor?.[0] || "未知廠商";
    const excelFile = files.excel[0].filepath;
    const imageFile = files.image[0].filepath;
    const imageData = fs.readFileSync(imageFile, { encoding: "base64" });

    const completion = await openai.createChatCompletion({
      model: "gpt-4-vision-preview",
      messages: [{
        role: "user",
        content: [
          { type: "text", text: "請從進貨單圖片中辨識出每筆品項，列出品號、品名、單位、單價，並用 JSON 陣列格式回覆。" },
          { type: "image_url", image_url: { url: `data:image/jpeg;base64,${imageData}` } }
        ]
      }],
      max_tokens: 2000
    });

    const raw = completion.data.choices[0].message.content;
    let ocrItems = [];
    try {
      ocrItems = JSON.parse(raw);
    } catch (e) {
      return res.status(500).json({ error: "解析失敗", raw });
    }

    // 讀取商品資料_ALL.xlsx 作比對
    const wb = xlsx.readFile(excelFile);
    const sheet = wb.Sheets[wb.SheetNames[0]];
    const db = xlsx.utils.sheet_to_json(sheet);

    const today = new Date();
    const ym = `${today.getFullYear()}${String(today.getMonth()+1).padStart(2,'0')}`;

    const result = ocrItems.map(row => {
      const match = db.find(item => similarity(item["品名"] || "", row.name) >= 0.7);
      const code = match?.["品號"] || generateCode(row.name);
      return {
        "品號": code,
        "品名": row.name,
        "單位": row.unit || "",
        "商品分類": "",
        "零售價": 0,
        "標準進價": row.price || "",
        "標準進價含稅": 0,
        "條碼編號": "",
        "計算庫存數量與成本": 1,
        "安全存量": "",
        "停售日期": "",
        "商品描述": `${vendor} ${ym}/${row.price || ""}`,
        "商品型態": 1,
        "庫存數量": "",
        "單位成本": "",
        "批號管理": "",
        "有效天數": "",
        "單位淨重(KG)": "",
        "主供應商": "",
        "電商平台庫存更新": "",
        "商品序號管理": "",
        "序號編碼代號": ""
      };
    });

    // 轉成 Excel
    const outWb = xlsx.utils.book_new();
    const outWs = xlsx.utils.json_to_sheet(result);
    xlsx.utils.book_append_sheet(outWb, outWs, "商品匯入");
    const outputPath = `/tmp/result_${Date.now()}.xlsx`;
    xlsx.writeFile(outWb, outputPath);

    const fileData = fs.readFileSync(outputPath);
    res.setHeader('Content-Disposition', 'attachment; filename="商品匯入.xlsx"');
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.send(fileData);
  });
}