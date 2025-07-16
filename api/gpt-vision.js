import formidable from "formidable";
import fs from "fs";
import { Configuration, OpenAIApi } from "openai";

export const config = {
  api: {
    bodyParser: false
  }
};

const openai = new OpenAIApi(new Configuration({
  apiKey: process.env.OPENAI_API_KEY
}));

export default async function handler(req, res) {
  const form = formidable({ multiples: false });

  form.parse(req, async (err, fields, files) => {
    if (err) return res.status(500).json({ error: "Upload error" });

    const imageData = fs.readFileSync(files.image[0].filepath, { encoding: "base64" });

    const completion = await openai.createChatCompletion({
      model: "gpt-4-vision-preview",
      messages: [{
        role: "user",
        content: [
          { type: "text", text: "請從進貨單圖片中辨識出每筆品項，列出品號、品名、單位、單價，並用 JSON 陣列格式回覆。" },
          { type: "image_url", image_url: { url: `data:image/jpeg;base64,${imageData}` } }
        ]
      }],
      max_tokens: 1000
    });

    try {
      const text = completion.data.choices[0].message.content;
      const items = JSON.parse(text);
      res.status(200).json({ items });
    } catch (e) {
      res.status(500).json({ error: "解析失敗", raw: completion.data.choices[0].message.content });
    }
  });
}
