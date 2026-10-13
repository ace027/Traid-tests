import { useState } from 'react';
import { Download, FileText } from 'lucide-react';
import { Button, Card, EmptyState, PageHeader, TBody, THead, Table, Td, Th, Tr, useToast } from '../../components/ui';
import { DateCell, LoadError, SkeletonRows } from '../activity/History';
import { downloadApiFile, errorMessage, formatBytes, useLogFiles, useSystemStatus } from './hooks';

const COLUMNS = 4;

export function LogFiles() {
  const toast = useToast();
  const files = useLogFiles();
  const status = useSystemStatus();
  const [downloading, setDownloading] = useState<string | null>(null);
  const appData = status.data?.appData;
  const sep = appData?.includes('\\') && !appData.includes('/') ? '\\' : '/';
  const logFolder = appData ? `${appData.replace(/[\\/]+$/, '')}${sep}logs` : null;

  const download = async (filename: string) => {
    setDownloading(filename);
    try {
      await downloadApiFile(`log/file/${encodeURIComponent(filename)}`, filename);
    } catch (error) {
      toast.error(`Download failed: ${errorMessage(error)}`);
    } finally {
      setDownloading(null);
    }
  };

  return (
    <>
      <PageHeader
        title="Log Files"
        description={
          logFolder ? (
            <>
              Log files are stored in <code className="font-mono break-all text-text">{logFolder}</code>. Open that folder
              to see them all.
            </>
          ) : (
            'Log files are stored in the logs folder inside the AppData directory.'
          )
        }
      />
      {files.isError && !files.data ? (
        <LoadError what="log files" error={files.error} onRetry={() => void files.refetch()} />
      ) : files.data && files.data.length === 0 ? (
        <EmptyState icon={<FileText />} title="No log files" description="Nothing has been written to disk yet." />
      ) : (
        <Card flush aria-busy={files.isPending || undefined}>
          <Table caption="Log files" captionHidden>
            <THead>
              <tr>
                <Th>Filename</Th>
                <Th>Last Write Time</Th>
                <Th>Size</Th>
                <Th>
                  <span className="sr-only">Actions</span>
                </Th>
              </tr>
            </THead>
            <TBody>
              {!files.data ? (
                <SkeletonRows columns={COLUMNS} />
              ) : (
                files.data.map((f) => (
                  <Tr key={f.filename}>
                    <Td className="font-medium break-all">{f.filename}</Td>
                    <Td>
                      <DateCell iso={f.lastWriteTime} />
                    </Td>
                    <Td className="whitespace-nowrap">{formatBytes(f.size)}</Td>
                    <Td className="text-right">
                      <Button
                        size="sm"
                        variant="ghost"
                        aria-label={`Download ${f.filename}`}
                        icon={<Download aria-hidden="true" />}
                        loading={downloading === f.filename}
                        onClick={() => void download(f.filename)}
                      >
                        Download
                      </Button>
                    </Td>
                  </Tr>
                ))
              )}
            </TBody>
          </Table>
        </Card>
      )}
    </>
  );
}
