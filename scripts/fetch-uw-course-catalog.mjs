import fs from 'node:fs/promises';
import path from 'node:path';

const ROOT_URL = 'https://guide.wisc.edu';
const COURSES_INDEX_URL = `${ROOT_URL}/courses/`;
const OUTPUT_PATH = path.join(process.cwd(), 'data', 'uw-course-catalog.json');

function decodeHtml(text) {
  return text
    .replace(/&amp;/g, '&')
    .replace(/&nbsp;/g, ' ')
    .replace(/&#160;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&#8211;/g, '–')
    .replace(/&#8212;/g, '—');
}

function normalizeWhitespace(text) {
  return decodeHtml(text).replace(/\s+/g, ' ').trim();
}

function stripTags(text) {
  return text.replace(/<[^>]+>/g, ' ');
}

async function fetchText(url) {
  let lastError;

  for (let attempt = 1; attempt <= 4; attempt += 1) {
    try {
      const response = await fetch(url, {
        headers: {
          'user-agent': 'studi-course-catalog-script/1.0',
        },
      });

      if (!response.ok) {
        throw new Error(`Failed to fetch ${url}: ${response.status} ${response.statusText}`);
      }

      return response.text();
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, attempt * 500));
    }
  }

  throw lastError;
}

function extractSubjects(indexHtml) {
  const subjectPattern = /<li><a href="(\/courses\/[^"]+\/)">([^<]+)<\/a><\/li>/g;
  const subjects = [];
  let match;

  while ((match = subjectPattern.exec(indexHtml)) !== null) {
    const [, slug, label] = match;
    const subjectMatch = label.match(/^(.*)\s+\(([^)]+)\)$/);

    subjects.push({
      slug,
      label: normalizeWhitespace(label),
      subjectCode: normalizeWhitespace(subjectMatch?.[2] ?? label),
      subjectName: normalizeWhitespace(subjectMatch?.[1] ?? label),
    });
  }

  return subjects;
}

function extractCourses(subject, subjectHtml) {
  const coursePattern =
    /<p class="courseblocktitle noindent"><strong>(?:<i[^>]*><\/i>\s*)?<span class="courseblockcode">([\s\S]*?)<\/span>\s+—\s+([\s\S]*?)<\/strong><\/p>[\s\S]*?<p class="courseblockcredits">([\s\S]*?)<\/p>[\s\S]*?<p class="courseblockdesc noindent">([\s\S]*?)<\/p>/g;

  const courses = [];
  let match;

  while ((match = coursePattern.exec(subjectHtml)) !== null) {
    const [, rawCode, rawTitle, rawCredits, rawDescription] = match;
    const code = normalizeWhitespace(stripTags(rawCode));
    const title = normalizeWhitespace(stripTags(rawTitle));
    const credits = normalizeWhitespace(stripTags(rawCredits));
    const description = normalizeWhitespace(stripTags(rawDescription));

    courses.push({
      code,
      title,
      credits,
      description,
      subjectCode: subject.subjectCode,
      subjectName: subject.subjectName,
      subjectSlug: subject.slug,
      url: `${ROOT_URL}${subject.slug}`,
      searchText: `${code} ${title} ${subject.subjectCode} ${subject.subjectName}`.toLowerCase(),
    });
  }

  return courses;
}

async function main() {
  const indexHtml = await fetchText(COURSES_INDEX_URL);
  const subjects = extractSubjects(indexHtml);
  const courses = [];

  for (const subject of subjects) {
    const subjectHtml = await fetchText(`${ROOT_URL}${subject.slug}`);
    const subjectCourses = extractCourses(subject, subjectHtml);
    courses.push(...subjectCourses);
    console.log(`Fetched ${subjectCourses.length} courses from ${subject.subjectCode}`);
    await new Promise((resolve) => setTimeout(resolve, 200));
  }

  await fs.mkdir(path.dirname(OUTPUT_PATH), { recursive: true });
  await fs.writeFile(
    OUTPUT_PATH,
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        source: COURSES_INDEX_URL,
        totalSubjects: subjects.length,
        totalCourses: courses.length,
        courses,
      },
      null,
      2
    )
  );

  console.log(`Saved ${courses.length} courses to ${OUTPUT_PATH}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
