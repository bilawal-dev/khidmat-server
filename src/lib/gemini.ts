import { ChatGoogleGenerativeAI } from '@langchain/google-genai';

if (!process.env.GEMINI_API_KEY) {
  throw new Error('FATAL ERROR: GEMINI_API_KEY environment variable is missing.');
}
if (!process.env.GEMINI_MODEL_NAME) {
  throw new Error('FATAL ERROR: GEMINI_MODEL_NAME environment variable is missing.');
}

export const gemini = new ChatGoogleGenerativeAI({
  model: process.env.GEMINI_MODEL_NAME,
  apiKey: process.env.GEMINI_API_KEY,
  temperature: 0,
});
