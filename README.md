# Personal Portfolio (shaiknagurshareef.github.io)

Welcome to my personal portfolio repository. This project showcases my skills, projects, and professional information in a simple, yet elegant format using HTML, CSS, and JavaScript.

## Table of Contents
- [Personal Portfolio (shaiknagurshareef.github.io)](#personal-portfolio-shaiknagurshareefgithubio)
  - [Table of Contents](#table-of-contents)
  - [About](#about)
  - [Technologies Used](#technologies-used)
  - [Project Structure](#project-structure)
  - [Setup Instructions](#setup-instructions)
  - [Features](#features)

## About
This personal portfolio website is designed to present my professional experience, projects, and skills. It serves as a digital resume and a showcase for potential employers or collaborators.

## Technologies Used
- **HTML**: Markup language to structure the content.
- **CSS**: Stylesheet language to design and layout the content.
- **JavaScript**: Programming language to add interactivity to the website.

## Project Structure
- `index.html`: the single-page portfolio.
- `css/styles.css` (Start Bootstrap theme), `css/theme.css` (dark mode, accessibility, publication filter), `css/chat.css` (chat widget).
- `js/scripts.js` (scrollspy, back-to-top), `js/theme.js` (theme toggle), `js/publications.js` (renders `data/*.json`, search and "oral only" filter), `js/chat.js` (chat widget).
- `data/`: publication JSON files, resumes, statement, certificates, reviewer certificates, `thesis/` (M.S. thesis PDF).
- `portfolio-chat-api/`: FastAPI chat backend deployed as a Hugging Face Space (see below).

## Setup Instructions
To view and edit the portfolio on your local machine, follow these steps:

1. **Clone the repository**:
    ```sh
    git clone https://github.com/shaiknagurshareef/shaiknagurshareef.github.io.git
    ```

2. **Navigate to the project directory**:
    ```sh
    cd shaiknagurshareef.github.io
    ```

3. **Serve the site locally** (the publication lists load JSON with `fetch`, so `file://` will not work):
    ```sh
    python3 -m http.server 8000
    ```
    Then open http://localhost:8000.

## Features
- **Responsive Design**: The portfolio is designed to be responsive and look good on all devices, including desktops, tablets, and mobile phones.
- **Project Showcase**: A section dedicated to showcasing my projects with descriptions and links.
- **Professional Information**: Sections for my bio, skills, experience, and contact information.
- **Interactive Elements**: JavaScript is used to add interactivity, such as form submissions and dynamic content.
## Chat assistant

The widget (`js/chat.js`) sends only the question and the last few turns to the backend; all knowledge lives server-side in `portfolio-chat-api/knowledge.md`.

**Refresh the knowledge file** after changing the research resume, statement, publication JSON or page content:
```sh
pip install pypdf
python3 portfolio-chat-api/build_knowledge.py
```

**Run the API locally** (needs a Gemini key from Google AI Studio):
```sh
cd portfolio-chat-api
pip install -r requirements.txt
GOOGLE_API_KEY=... uvicorn app:app --port 7861
# then browse http://localhost:8000/?chat_api=http://localhost:7861
```

**Deploy:** push `app.py`, `knowledge.md`, `requirements.txt` and `Dockerfile` to the Hugging Face Space, and set the Space secret `GOOGLE_API_KEY`. Optional Space variables: `CHAT_MODELS` (comma-separated, default `gemini-2.5-flash,gemini-2.5-flash-lite`), `RATE_PER_IP` (per minute, default 12), `RATE_GLOBAL` (per hour, default 600).

Endpoints: `POST /chat/stream` (SSE), `POST /chat`, `GET /health`. The API ignores any client-supplied system prompt, caps input sizes, and rate-limits per IP.
