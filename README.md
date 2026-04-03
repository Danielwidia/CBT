# CBT Exam Browser - Project Online

A consolidated, single-root Node.js application for managing and delivering computer-based tests.

## 🚀 Getting Started

### Prerequisites
- [Node.js](https://nodejs.org/) (v18 or higher recommended)

### Installation
1. Clone the repository:
   ```bash
   git clone <repository-url>
   ```
2. Install dependencies:
   ```bash
   npm install
   ```

### Running the Application
To start the server:
```bash
npm start
```
The application will be available at `http://localhost:3000`.

## 📂 Project Structure
- `server.js`: Main backend entry point using Express.
- `wordParser.js`: Logic for parsing Word (.docx) exam files.
- `frontend/`: Static web assets (HTML, CSS, JS).
- `package.json`: Project configuration and dependencies.
- `.env`: Environment variables (API keys, etc.).
- `database.json`: Local storage for questions and students (auto-generated).
- `results.json`: Local storage for exam results (auto-generated).

## 🛠 Features
- **Exam Management**: Create and manage questions and students.
- **AI Question Generation**: Integration with Google Gemini for automated question creation.
- **Word Import**: Import questions directly from Microsoft Word documents.
- **Virtual Hotspot**: Built-in Windows hotspot management for local network exams.

---
Created by Daniel Widiatmoko (2026)
