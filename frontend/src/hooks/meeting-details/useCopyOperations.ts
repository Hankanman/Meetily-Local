import { useCallback, RefObject } from 'react';
import { Transcript, Summary } from '@/types';
import { TiptapSummaryViewRef } from '@/components/AISummary/TiptapSummaryView';
import { toast } from 'sonner';
import Analytics from '@/lib/analytics';
import { invoke as invokeTauri } from '@tauri-apps/api/core';
import { formatRecordingTime } from '@/lib/utils';

interface UseCopyOperationsProps {
  meeting: any;
  transcripts: Transcript[];
  meetingTitle: string;
  aiSummary: Summary | null;
  summaryRef: RefObject<TiptapSummaryViewRef | null>;
}

export function useCopyOperations({
  meeting,
  transcripts,
  meetingTitle,
  aiSummary,
  summaryRef,
}: UseCopyOperationsProps) {

  // Helper function to fetch ALL transcripts for copying (not just paginated data)
  const fetchAllTranscripts = useCallback(async (meetingId: string): Promise<Transcript[]> => {
    try {
      // First, get total count by fetching first page
      const firstPage = await invokeTauri('api_get_meeting_transcripts', {
        meetingId,
        limit: 1,
        offset: 0,
      }) as { transcripts: Transcript[]; total_count: number; has_more: boolean };

      const totalCount = firstPage.total_count;

      if (totalCount === 0) {
        return [];
      }

      // Fetch all transcripts in one call
      const allData = await invokeTauri('api_get_meeting_transcripts', {
        meetingId,
        limit: totalCount,
        offset: 0,
      }) as { transcripts: Transcript[]; total_count: number; has_more: boolean };

      return allData.transcripts;
    } catch (error) {
      console.error('Error fetching all transcripts:', error);
      toast.error('Failed to fetch transcripts for copying');
      return [];
    }
  }, []);

  // Copy transcript to clipboard
  const handleCopyTranscript = useCallback(async () => {
    const allTranscripts = await fetchAllTranscripts(meeting.id);

    if (!allTranscripts.length) {
      toast.error('No transcripts available to copy');
      return;
    }

    const header = `# Transcript of the Meeting: ${meeting.id} - ${meetingTitle ?? meeting.title}\n\n`;
    const date = `## Date: ${new Date(meeting.created_at).toLocaleDateString()}\n\n`;
    // Old transcripts predate audio_start_time and fall back to wall-clock time
    const fullTranscript = allTranscripts
      .map(t => `${t.audio_start_time !== undefined ? formatRecordingTime(t.audio_start_time) : t.timestamp} ${t.text}  `)
      .join('\n');

    await navigator.clipboard.writeText(header + date + fullTranscript);
    toast.success("Transcript copied to clipboard");

    // Track copy analytics
    const wordCount = allTranscripts
      .map(t => t.text.split(/\s+/).length)
      .reduce((a, b) => a + b, 0);

    await Analytics.trackCopy('transcript', {
      meeting_id: meeting.id,
      transcript_length: allTranscripts.length.toString(),
      word_count: wordCount.toString()
    });
  }, [meeting, meetingTitle, fetchAllTranscripts]);

  // Copy summary to clipboard
  const handleCopySummary = useCallback(async () => {
    try {
      let summaryMarkdown = '';

      // Try to get markdown from BlockNote editor first
      if (summaryRef.current?.getMarkdown) {
        summaryMarkdown = await summaryRef.current.getMarkdown();
      }

      // Fallback: Check if aiSummary has markdown property
      if (!summaryMarkdown && aiSummary && 'markdown' in aiSummary) {
        summaryMarkdown = (aiSummary as any).markdown || '';
      }

      // Fallback: Check for legacy format
      if (!summaryMarkdown && aiSummary) {
        const sections = Object.entries(aiSummary)
          .filter(([key]) => {
            // Skip non-section keys
            return key !== 'markdown' && key !== 'summary_json' && key !== '_section_order' && key !== 'MeetingName';
          })
          .map(([, section]) => {
            if (section && typeof section === 'object' && 'title' in section && 'blocks' in section) {
              const sectionTitle = `## ${section.title}\n\n`;
              const sectionContent = section.blocks
                .map((block: any) => `- ${block.content}`)
                .join('\n');
              return sectionTitle + sectionContent;
            }
            return '';
          })
          .filter(s => s.trim())
          .join('\n\n');
        summaryMarkdown = sections;
      }

      // If still no summary content, show message
      if (!summaryMarkdown.trim()) {
        toast.error('No summary content available to copy');
        return;
      }

      // Build metadata header
      const header = `# Meeting Summary: ${meetingTitle}\n\n`;
      const metadata = `**Meeting ID:** ${meeting.id}\n**Date:** ${new Date(meeting.created_at).toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
      })}\n**Copied on:** ${new Date().toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
      })}\n\n---\n\n`;

      const fullMarkdown = header + metadata + summaryMarkdown;
      await navigator.clipboard.writeText(fullMarkdown);

      toast.success("Summary copied to clipboard");

      // Track copy analytics
      await Analytics.trackCopy('summary', {
        meeting_id: meeting.id,
        has_markdown: (!!aiSummary && 'markdown' in aiSummary).toString()
      });
    } catch (error) {
      console.error('Failed to copy summary:', error);
      toast.error("Failed to copy summary");
    }
  }, [aiSummary, meetingTitle, meeting, summaryRef]);

  return {
    handleCopyTranscript,
    handleCopySummary,
  };
}
