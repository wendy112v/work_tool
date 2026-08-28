import { createClient } from '@supabase/supabase-js';
import * as cheerio from 'cheerio';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;
const CONFLUENCE_TOKEN = process.env.KAKAO_WIKI_API_TOKEN;

const BASE_URL = 'https://wiki.daumkakao.com';
const PARENT_PAGE_ID = '1995026742'; 

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// 🔍 "공지" 및 "공유" 섹션만 핀포인트 추출하는 함수
function extractNoticeSections(fullHtml) {
    const $ = cheerio.load(fullHtml);
    let resultHtml = '';

    $('h1, h2, h3, h4, p > strong').each((_, el) => {
        const titleText = $(el).text().trim();

        if (titleText.includes('공지') || titleText.includes('공유')) {
            resultHtml += $.html(el);

            let nextEl = $(el).next();
            while (nextEl.length && !nextEl.is('h1, h2, h3, h4')) {
                resultHtml += $.html(nextEl);
                nextEl = nextEl.next();
            }
        }
    });

    return resultHtml;
}

// ♾️ 개수 제한 없이 모든 하위 페이지를 싹 쓸어오는 재귀 호출 함수
async function fetchAllChildPages(parentId) {
    let allPages = [];
    let start = 0;
    const limit = 50; 
    let hasMore = true;

    while (hasMore) {
        const apiUrl = `${BASE_URL}/rest/api/content/${parentId}/child/page?expand=body.storage&start=${start}&limit=${limit}`;
        
        const response = await fetch(apiUrl, {
            headers: {
                'Authorization': `Bearer ${CONFLUENCE_TOKEN}`,
                'Accept': 'application/json'
            }
        });

        if (!response.ok) {
            throw new Error(`위키 API 접근 실패 (${response.status}): 사내 망 연결 및 토큰 권한을 확인하세요.`);
        }

        const data = await response.json();
        const pages = data.results || [];
        allPages = allPages.concat(pages);

        // 가져온 데이터가 limit보다 적거나 다음 페이지 링크가 없으면 반복 종료
        if (pages.length < limit || !data._links?.next) {
            hasMore = false;
        } else {
            start += limit; // 다음 50개를 가져오도록 위치 이동
        }
    }

    return allPages;
}

async function syncConfluencePages() {
    try {
        console.log("🚀 회의록 동기화 시작...");

        // 개수 제한 없이 모든 하위 페이지 수집
        const pages = await fetchAllChildPages(PARENT_PAGE_ID);

        console.log(`📁 총 ${pages.length}개의 주간 회의록 하위 페이지를 발견했습니다.`);

        for (const page of pages) {
            const pageTitle = page.title;
            const fullStorageHtml = page.body?.storage?.value || '';

            const noticesOnlyHtml = extractNoticeSections(fullStorageHtml);

            if (!noticesOnlyHtml) {
                console.log(`⏩ '${pageTitle}': 공지/공유사항 섹션이 없어 건너뜁니다.`);
                continue;
            }

            const today = new Date().toISOString().split('T')[0];

            const { error } = await supabase
                .from('announcements')
                .upsert({
                    title: pageTitle,
                    content: noticesOnlyHtml,
                    category: 'general',
                    date: today,
                    tags: ['주간회의록', '카카오위키']
                }, { onConflict: 'title' });

            if (error) {
                console.error(`❌ '${pageTitle}' DB 저장 실패:`, error.message);
            } else {
                console.log(`✅ '${pageTitle}' 공지/공유사항 추출 및 동기화 완료!`);
            }
        }
    } catch (err) {
        console.error("❌ 오류 발생:", err.message);
    }
}

syncConfluencePages();
