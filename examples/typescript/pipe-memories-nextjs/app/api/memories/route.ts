import { NextResponse, NextRequest } from 'next/server';
import path from 'path';
import fs from 'fs/promises';
import { performSearch } from './pipe';

export async function GET() {
    try {
        const filePath = path.join(process.cwd(), 'app', 'api', 'memories', 'memories-queries-prompts.json');
        console.log('attempting to read file:', filePath);
        const fileContents = await fs.readFile(filePath, 'utf8');
        console.log('file contents:', fileContents);
        const jsonData = JSON.parse(fileContents);
        return new NextResponse(JSON.stringify(jsonData), {
            status: 200,
            headers: { 'Content-Type': 'application/json' }
        });
    } catch (error) {
        console.error('error reading json file:', error);
        return new NextResponse(JSON.stringify({ error: 'failed to read memories data', details: error.message }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' }
        });
    }
}

export async function POST(request: NextRequest) {
    try {
        const body = await request.json();
        const { searchTerm, searchKeywords, appsAndWindows, limit, contentType, gptModel, similarityThreshold } = body;

        if (!searchTerm || !searchKeywords || !Array.isArray(searchKeywords)) {
            return new NextResponse(JSON.stringify({ error: 'invalid request body' }), {
                status: 400,
                headers: { 'Content-Type': 'application/json' }
            });
        }

        const results = await performSearch(
            searchTerm,
            searchKeywords,
            appsAndWindows,
            limit,
            contentType,
            gptModel,
            similarityThreshold
        );

        return new NextResponse(JSON.stringify(results), {
            status: 200,
            headers: { 'Content-Type': 'application/json' }
        });
    } catch (error) {
        console.error('error performing search:', error);
        return new NextResponse(JSON.stringify({ error: 'failed to perform search', details: error.message }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' }
        });
    }
}
