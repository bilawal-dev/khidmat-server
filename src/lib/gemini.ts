import { ChatGoogleGenerativeAI } from '@langchain/google-genai';
import { env } from '../config/env';

export const gemini = new ChatGoogleGenerativeAI({
  model: env.GEMINI_MODEL_NAME,
  apiKey: env.GEMINI_API_KEY,
  temperature: 0,
});
