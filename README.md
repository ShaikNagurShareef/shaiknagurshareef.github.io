Here is the updated `README.md` file. I have added the new architecture (Netlify Functions), the specific commands to run the serverless backend locally, and the list of dependencies.

Copy the code below and replace your existing `README.md`.

```markdown
# Personal Portfolio & AI Assistant (shaiknagurshareef.github.io)

Welcome to my personal portfolio repository. This project showcases my research, industry experience, and technical skills. 

🚀 **New Feature:** This portfolio now includes a custom **RAG (Retrieval-Augmented Generation) AI Assistant**. The chatbot reads my Resume (PDF) and publication data (JSON) in real-time to answer questions about my professional background using Google's Gemini API.

## Table of Contents
- [About](#about)
- [Technologies Used](#technologies-used)
- [Project Structure](#project-structure)
- [Prerequisites](#prerequisites)
- [Setup Instructions (Local Development)](#setup-instructions-local-development)
- [Deployment](#deployment)
- [Features](#features)

## About
This website serves as a digital resume and interactive portfolio. Unlike static portfolios, this site employs a serverless backend to secure API keys and process natural language queries, allowing visitors to chat with a "digital avatar" of myself.

## Technologies Used

### Frontend
- **HTML5 & CSS3**: Bootstrap 5 framework for responsive design.
- **JavaScript (ES6+)**: Client-side logic and API handling.
- **PDF.js**: For extracting text context from the Resume PDF.
- **Marked.js**: For rendering Markdown responses from the AI into HTML.

### Backend & AI
- **Netlify Functions**: Serverless Node.js environment to proxy API requests and hide secrets.
- **Google Gemini API**: Utilizing `gemini-3-flash-preview` for high-speed inference.
- **Node.js**: Runtime environment for the backend logic.

## Project Structure
```text
/
├── css/                 # Stylesheets
├── data/                # Data sources (JSONs & PDFs used for RAG context)
├── img/                 # Images and Icons
├── js/                  # Frontend scripts
├── netlify/
│   └── functions/       # Serverless backend scripts (chat.js)
├── index.html           # Main entry point
├── package.json         # Backend dependencies list
├── .gitignore           # Files to exclude from Git
└── README.md            # Project documentation
```

## Prerequisites
To run this project locally with full AI functionality, you need:
1.  **Node.js** (v18 or higher) installed on your machine.
2.  A **Google Gemini API Key** (Get one from [Google AI Studio](https://aistudio.google.com/)).

## Setup Instructions (Local Development)

Because this project uses serverless functions, you cannot simply open `index.html`. You must run a local development server.

1.  **Clone the repository**:
    ```sh
    git clone https://github.com/shaiknagurshareef/shaiknagurshareef.github.io.git
    ```

2.  **Navigate to the project directory**:
    ```sh
    cd shaiknagurshareef.github.io
    ```

3.  **Install dependencies**:
    This installs the required backend libraries (like `@google/generative-ai`).
    ```sh
    npm install
    ```

4.  **Install Netlify CLI globally**:
    This tool allows you to simulate the Netlify cloud environment locally.
    ```sh
    npm install -g netlify-cli
    ```

5.  **Configure Environment Variables**:
    Create a file named `.env` in the root directory and add your API Key.
    > **⚠️ IMPORTANT:** Never commit the `.env` file to GitHub!
    ```env
    GEMINI_API_KEY=your_actual_google_api_key_here
    ```

6.  **Run the local server**:
    ```sh
    netlify dev
    ```
    The site will usually open at `http://localhost:8888`. The AI chat will now work locally.

## Deployment

This site is optimized for **Netlify**.

1.  Push your code to GitHub (ensure `node_modules` and `.env` are in your `.gitignore`).
2.  Import the repository into Netlify.
3.  In Netlify **Site Settings > Environment Variables**, add:
    *   Key: `GEMINI_API_KEY`
    *   Value: `[Your Google API Key]`
4.  Deploy! Netlify will automatically detect the `netlify/functions` folder and deploy the backend.

## Features
- **🤖 AI Chat Widget**: A context-aware chatbot that answers questions based on my actual Resume and Research Statement.
- **📄 PDF Parsing**: Front-end extraction of text from PDFs to feed the AI context window.
- **📱 Fully Responsive**: Optimized for Mobile, Tablet, and Desktop.
- **🔒 Secure Architecture**: API keys are hidden server-side, preventing leakage.
- **🔍 Dynamic Research Data**: JSON-based loading of Publications and Conferences.
```