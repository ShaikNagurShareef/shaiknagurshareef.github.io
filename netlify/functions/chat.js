const { GoogleGenerativeAI } = require("@google/generative-ai");

exports.handler = async function(event, context) {
  // Only allow POST requests
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method Not Allowed" };
  }

  try {
    // 1. Get the securely stored key from Netlify Environment Variables
    const API_KEY = process.env.GEMINI_API_KEY;
    if (!API_KEY) {
      return { statusCode: 500, body: "Missing API Key" };
    }

    // 2. Parse the incoming body (Prompt + Context)
    const data = JSON.parse(event.body);
    const { message, systemInstruction } = data;

    // 3. Initialize Gemini (Server-side)
    const genAI = new GoogleGenerativeAI(API_KEY);
    // Note: Using flash model as per your original code
    const model = genAI.getGenerativeModel({ 
        model: "gemini-3-flash-preview", // 'gemini-3-flash-preview' might be unstable via REST, 1.5 is safer for prod
        systemInstruction: systemInstruction 
    });

    // 4. Generate Content
    const result = await model.generateContent(message);
    const response = await result.response;
    const text = response.text();

    // 5. Return result to frontend
    return {
      statusCode: 200,
      body: JSON.stringify({ reply: text }),
    };

  } catch (error) {
    console.error("Error:", error);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: error.message }),
    };
  }
};