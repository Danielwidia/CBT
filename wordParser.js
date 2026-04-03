const mammoth = require('mammoth');
const fs = require('fs');

/**
 * Parse a Word document (.docx) containing questions in table or text format
 */
async function parseWordDocument(fileBuffer, metadata = {}) {
    try {
        const result = await mammoth.convertToHtml({ buffer: fileBuffer });
        const html = result.value;
        const tables = extractTablesFromHtml(html);
        
        let questions = [];

        if (tables.length > 0) {
            questions = convertTableToQuestions(tables[0], metadata);
            if (questions.length === 0) {
                const textResult = await mammoth.extractRawText({ buffer: fileBuffer });
                questions = parseTextFormatQuestions(textResult.value, metadata);
            }
        } else {
            const textResult = await mammoth.extractRawText({ buffer: fileBuffer });
            questions = parseTextFormatQuestions(textResult.value, metadata);
        }

        return {
            success: true,
            count: questions.length,
            questions: questions,
            warnings: result.warnings || []
        };
    } catch (error) {
        return {
            success: false,
            error: error.message,
            count: 0,
            questions: []
        };
    }
}

function extractTablesFromHtml(html) {
    const tables = [];
    const tableRegex = /<table[^>]*>([\s\S]*?)<\/table>/gi;
    let tableMatch;
    while ((tableMatch = tableRegex.exec(html)) !== null) {
        const tableContent = tableMatch[1];
        const rows = [];
        const rowRegex = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
        let rowMatch;
        while ((rowMatch = rowRegex.exec(tableContent)) !== null) {
            const rowContent = rowMatch[1];
            const cells = [];
            const cellRegex = /<(?:td|th)[^>]*>([\s\S]*?)<\/(?:td|th)>/gi;
            let cellMatch;
            while ((cellMatch = cellRegex.exec(rowContent)) !== null) {
                cells.push(cleanHtmlText(cellMatch[1]).trim());
            }
            if (cells.length > 0 && cells.some(c => c.length > 0)) rows.push(cells);
        }
        if (rows.length > 0) tables.push(rows);
    }
    return tables;
}

function cleanHtmlText(html) {
    let text = html.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
                  .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
                  .replace(/<[^>]+>/g, ' ')
                  .replace(/&nbsp;/g, ' ')
                  .replace(/&lt;/g, '<')
                  .replace(/&gt;/g, '>')
                  .replace(/&amp;/g, '&');
    return text.replace(/\s+/g, ' ').trim();
}

function convertTableToQuestions(table, metadata = {}) {
    const questions = [];
    let startIndex = 0;
    if (table.length > 0) {
        const firstRow = table[0];
        const headerKeywords = ['question', 'soal', 'pertanyaan', 'option', 'pilihan', 'answer', 'kunci'];
        if (firstRow.some(cell => headerKeywords.some(keyword => cell.toLowerCase().includes(keyword)))) {
            startIndex = 1;
        }
    }
    for (let i = startIndex; i < table.length; i++) {
        const row = table[i];
        if (row.length < 3) continue;
        const questionText = row[0];
        const correctAnswersRaw = row[row.length - 1];
        let options = row.slice(1, -1).map(opt => opt.trim()).filter(Boolean);
        
        const questionObj = parseQuestionRow(questionText, options, correctAnswersRaw, metadata);
        if (questionObj) questions.push(questionObj);
    }
    return questions;
}

function parseQuestionRow(question, options, correctAnswersRaw, metadata) {
    if (!question || options.length < 1 || !correctAnswersRaw) return null;
    const correctIndices = parseCorrectAnswers(correctAnswersRaw, options);
    if (correctIndices === null) {
        return {
            text: question.trim(), type: 'text', correct: correctAnswersRaw.trim(),
            mapel: metadata.subject || 'General', rombel: metadata.class || ''
        };
    }
    if (Array.isArray(correctIndices)) {
        return {
            text: question.trim(),
            type: correctIndices.length === 1 ? 'single' : 'multiple',
            options,
            correct: correctIndices.length === 1 ? correctIndices[0] : correctIndices,
            mapel: metadata.subject || 'General', rombel: metadata.class || ''
        };
    }
    return null;
}

function parseCorrectAnswers(raw, options) {
    const raw_trimmed = raw.trim();
    if (!raw_trimmed) return null;
    const indices = new Set();
    let parts = raw_trimmed.split(/[,;\/]+/).map(p => p.trim()).filter(Boolean);
    for (const part of parts) {
        if (/^[A-Z]$/i.test(part)) {
            const idx = part.toUpperCase().charCodeAt(0) - 65;
            if (idx >= 0 && idx < options.length) indices.add(idx);
        } else if (/^\d+$/.test(part)) {
            const idx = parseInt(part, 10) - 1;
            if (idx >= 0 && idx < options.length) indices.add(idx);
        } else {
            const idx = options.findIndex(opt => opt.toLowerCase() === part.toLowerCase());
            if (idx !== -1) indices.add(idx);
        }
    }
    return indices.size > 0 ? Array.from(indices).sort((a, b) => a - b) : null;
}

function parseTextFormatQuestions(rawText, metadata = {}) {
    const questions = [];
    const lines = rawText.split('\n').map(line => line.trim()).filter(Boolean);
    let i = 0;
    while (i < lines.length) {
        const questionData = parseSingleTextQuestion(lines, i, metadata);
        if (questionData.question) {
            questions.push(questionData.question);
            i = questionData.nextIndex;
        } else {
            i++;
        }
    }
    return questions;
}

function parseSingleTextQuestion(lines, startIndex, metadata) {
    let i = startIndex;
    let questionText = lines[i++];
    const numMatch = questionText.match(/^\d+\.\s*(.+)$/);
    if (numMatch) questionText = numMatch[1].trim();

    const options = [];
    while (i < lines.length && options.length < 6) {
        const line = lines[i];
        const match = line.match(/^[A-F][\.\)\:\-]?\s*(.+)$/i);
        if (match) {
            options.push(match[1].trim());
            i++;
        } else break;
    }

    let correctAnswer = null;
    if (i < lines.length) {
        const line = lines[i];
        const match = line.match(/\b(?:kunci|jawaban)\b[\s:\-]*([^\r\n]+)$/i);
        if (match) {
            correctAnswer = match[1].trim();
            i++;
        }
    }

    if (correctAnswer) {
        const indices = options.length >= 2 ? parseCorrectAnswers(correctAnswer, options) : null;
        const qObj = {
            text: questionText,
            mapel: metadata.subject || 'General',
            rombel: metadata.class || ''
        };
        if (indices) {
            qObj.type = indices.length === 1 ? 'single' : 'multiple';
            qObj.options = options;
            qObj.correct = indices.length === 1 ? indices[0] : indices;
        } else {
            qObj.type = 'text';
            qObj.correct = correctAnswer;
        }
        return { question: qObj, nextIndex: i };
    }
    return { question: null, nextIndex: i };
}

module.exports = { parseWordDocument };
