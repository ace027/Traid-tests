import { describe, expect, it } from 'vitest';
import { decodeEntities, readCaps, readError, readRssItems } from './xml.js';

const feed = (items: string) =>
  `<?xml version="1.0" encoding="UTF-8"?><rss version="2.0" xmlns:newznab="http://www.newznab.com/DTD/2010/feeds/attributes/"><channel><title>x</title>${items}</channel></rss>`;

describe('xml', () => {
  it('decodes entities', () => {
    expect(decodeEntities('a &amp; b &lt;c&gt; &quot;d&quot; &apos;e&apos; &#65;&#x42; &bogus; &')).toBe(
      `a & b <c> "d" 'e' AB &bogus; &`,
    );
  });

  it('parses items, attrs, CDATA and enclosure', () => {
    const items = readRssItems(
      feed(`<item><title><![CDATA[Show & Co S01E01]]></title><guid>g1</guid><link>http://x/y?a=1&amp;b=2</link>
      <pubDate>Mon, 02 Jan 2023 10:00:00 +0000</pubDate><description>ignored &lt;b&gt;</description>
      <enclosure url="http://x/dl?a=1&amp;b=2" length="123" type="application/x-nzb"/>
      <newznab:attr name="category" value="5040"/><newznab:attr name="category" value="5000"/></item>`),
    );
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      title: 'Show & Co S01E01',
      guid: 'g1',
      link: 'http://x/y?a=1&b=2',
      enclosure: { url: 'http://x/dl?a=1&b=2', length: '123' },
    });
    expect(items[0]!.attrs.category).toEqual(['5040', '5000']);
  });

  it('handles zero items and non-xml', () => {
    expect(readRssItems(feed(''))).toEqual([]);
    expect(readRssItems('<html><body>nope</body></html>')).toEqual([]);
  });

  it('does not confuse <items> with <item>', () => {
    expect(readRssItems('<items><x/></items>')).toEqual([]);
  });

  it('reads errors and caps', () => {
    expect(readError('<error code="100" description="Incorrect user credentials"/>')).toEqual({
      code: 100,
      description: 'Incorrect user credentials',
    });
    expect(readError(feed(''))).toBeNull();
    const caps = readCaps(
      `<caps><searching><search available="yes"/><tv-search available="yes" supportedParams="q,tvdbid,season,ep"/></searching>
      <categories><category id="5000" name="TV"><subcat id="5040" name="HD"/></category></categories></caps>`,
    );
    expect(caps).toEqual({
      searchAvailable: true,
      tvSearchAvailable: true,
      tvSearchParams: ['q', 'tvdbid', 'season', 'ep'],
      categories: [
        { id: 5000, name: 'TV' },
        { id: 5040, name: 'HD' },
      ],
    });
    expect(readCaps('<caps><searching><tv-search available="no"/></searching></caps>').tvSearchAvailable).toBe(false);
  });

  it('parses 5 MB of pathological input quickly', () => {
    const inputs = [
      '<item ' + 'a="'.repeat(10) + '<'.repeat(2_500_000),
      '<item>' + '<newznab:attr name="x" value="&amp;'.repeat(100_000) + '&'.repeat(1_000_000),
      feed('<item><title>t</title></item>'.repeat(150_000)),
      '<![CDATA['.repeat(500_000),
    ];
    for (const xml of inputs) {
      for (const fn of [readRssItems, readCaps, readError]) {
        const t = performance.now();
        fn(xml);
        expect(performance.now() - t).toBeLessThan(500);
      }
    }
  });
});
