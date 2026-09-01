import { createClient } from '@supabase/supabase-js';
import * as cheerio from 'cheerio';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;
const CONFLUENCE_TOKEN = process.env.KAKAO_WIKI_API_TOKEN;

const BASE_URL = 'https://wiki.daumkakao.com';
const PARENT_PAGE_ID = '1995026742'; 

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

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

        if (pages.length < limit || !data._links?.next) {
            hasMore = false;
        } else {
            start += limit;
        }
    }

    return allPages;
}

async function syncConfluencePages() {
    try {
        console.log("🚀 카카오 컨플루언스 회의록 전체 동기화 시작...");

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

            // 1. 동일한 제목의 데이터가 DB에 이미 있는지 확인
            const { data: existing } = await supabase
                .from('announcements')
                .select('id')
                .eq('title', pageTitle)
                .maybeSingle();

            let error;
            if (existing) {
                // 2. 기존 데이터가 존재하면 내용 업데이트
                ({ error } = await supabase
                    .from('announcements')
                    .update({
                        content: noticesOnlyHtml,
                        date: today
                    })
                    .eq('id', existing.id));
            } else {
                // 3. 새 데이터면 신규 등록
                ({ error } = await supabase
                    .from('announcements')
                    .insert({
                        title: pageTitle,
                        content: noticesOnlyHtml,
                        category: 'general',
                        date: today,
                        tags: ['주간회의록', '카카오위키']
                    }));
            }

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
