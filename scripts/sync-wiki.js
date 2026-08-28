import fs from 'fs';
import path from 'path';
import { marked } from 'marked';
import { createClient } from '@supabase/supabase-js';

// 환경변수에서 Supabase 접속 정보 로드
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;
const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// 체크아웃된 위키 폴더 경로
const wikiDir = path.join(process.cwd(), 'wiki-repo');

async function syncWikiToSupabase() {
    if (!fs.existsSync(wikiDir)) {
        console.error('❌ 위키 디렉토리를 찾을 수 없습니다.');
        return;
    }

    const files = fs.readdirSync(wikiDir);
    const mdFiles = files.filter(file => file.endsWith('.md') && !file.startsWith('_'));

    console.log(`📁 총 ${mdFiles.length}개의 위키 페이지 감지됨.`);

    for (const file of mdFiles) {
        const filePath = path.join(wikiDir, file);
        const fileContent = fs.readFileSync(filePath, 'utf-8');
        
        // 파일명에서 확장자 제거하여 제목으로 사용 (예: "QA-Guideline.md" -> "QA Guideline")
        const rawTitle = path.basename(file, '.md').replace(/-/g, ' ');
        
        // 마크다운 문법을 HTML 서식으로 자동 변환
        const htmlContent = marked.parse(fileContent);

        // 카테고리 태그 분류 (파일명에 QA, Monitoring 등이 포함되어 있으면 자동 매핑)
        let category = 'general';
        const lowerFile = file.toLowerCase();
        if (lowerFile.includes('qa')) category = 'qa';
        else if (lowerFile.includes('monitoring') || lowerFile.includes('모니터링')) category = 'monitoring';

        const today = new Date().toISOString().split('T')[0];

        // Supabase DB에 Upsert (제목이 중복되면 내용 업데이트)
        const { error } = await supabase
            .from('announcements')
            .upsert(
                { 
                    title: rawTitle, 
                    content: htmlContent, 
                    category: category, 
                    date: today,
                    tags: ['GitHubWiki']
                }, 
                { onConflict: 'title' }
            );

        if (error) {
            console.error(`❌ '${rawTitle}' 동기화 실패:`, error.message);
        } else {
            console.log(`✅ '${rawTitle}' 동기화 성공!`);
        }
    }
}

syncWikiToSupabase();
