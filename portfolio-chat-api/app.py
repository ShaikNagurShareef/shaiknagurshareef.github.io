import os
import google.generativeai as genai
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
from fastapi.middleware.cors import CORSMiddleware

# 1. Configure API
api_key = os.getenv("GOOGLE_API_KEY")
if not api_key:
    raise ValueError("GOOGLE_API_KEY secret not set")

genai.configure(api_key=api_key)

# 2. Setup FastAPI
app = FastAPI()

# 3. CORS SECURITY
origins = [
    "https://shaiknagurshareef.github.io",
    "http://localhost:5500",
    "http://127.0.0.1:5500"
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# 4. Data Model
class ChatRequest(BaseModel):
    message: str
    context: str

# --- CONFIGURATION: Model Fallback List ---
# The code will try these in order. 
# Note: "gemini-3" does not exist publicly yet. 
# I have added the actual current best models below.
MODELS_TO_TRY = [
    "gemini-3-flash-preview",
    "gemini-3-pro-preview",
    "gemini-2.5-flash",
    "gemini-2.5-pro",
    "gemini-2.5-flash-preview-09-2025",
    "gemini-2.5-flash-lite",
    "gemini-2.5-flash-lite-preview-09-2025",
    "gemini-2.0-flash",
    "gemini-2.0-flash-lite"
]

# 5. Chat Endpoint with Fallback Logic
@app.post("/chat")
async def generate_chat(request: ChatRequest):
    last_error = None
    
    # Iterate through the list of models
    for model_name in MODELS_TO_TRY:
        try:
            print(f"Attempting to use model: {model_name}")
            
            # Initialize the specific model
            model = genai.GenerativeModel(
                model_name=model_name,
                system_instruction=request.context
            )
            
            # Generate response
            response = model.generate_content(request.message)
            
            # If successful, return immediately and stop the loop
            return {"reply": response.text}
        
        except Exception as e:
            # Log the error but continue the loop
            print(f"WARNING: Model {model_name} failed. Error: {str(e)}")
            last_error = e
            continue 

    # If the loop finishes and nothing worked, raise an error
    print("CRITICAL: All models failed.")
    raise HTTPException(
        status_code=500, 
        detail=f"All AI models are currently busy or unavailable. Last error: {str(last_error)}"
    )

@app.get("/")
def home():
    return {"status": "API is running with Multi-Model Fallback."}