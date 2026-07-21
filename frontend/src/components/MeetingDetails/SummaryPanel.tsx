"use client";

import { Summary, SummaryResponse, Transcript } from "@/types";
import { EditableTitle } from "@/components/EditableTitle";
import {
  TiptapSummaryView,
  TiptapSummaryViewRef,
} from "@/components/AISummary/TiptapSummaryView";
import { EmptyStateSummary } from "@/components/EmptyStateSummary";
import { ModelConfig } from "@/components/ModelSettingsModal";
import { SummaryGeneratorButtonGroup } from "./SummaryGeneratorButtonGroup";
import { SummaryUpdaterButtonGroup } from "./SummaryUpdaterButtonGroup";
import { CalendarEventPanel } from "./CalendarEventPanel";
import { ActionItemsPanel } from "./ActionItemsPanel";
import { MeetingNotesPanel } from "./MeetingNotesPanel";
import { ExportMenu } from "./ExportMenu";
import { Heading } from "@/components/ui/typography";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { RefObject } from "react";

interface SummaryPanelProps {
  meeting: {
    id: string;
    title: string;
    created_at: string;
  };
  meetingTitle: string;
  onTitleChange: (title: string) => void;
  isEditingTitle: boolean;
  onStartEditTitle: () => void;
  onFinishEditTitle: () => void;
  isTitleDirty: boolean;
  isSummaryDirty: boolean;
  summaryRef: RefObject<TiptapSummaryViewRef | null>;
  isSaving: boolean;
  onSaveAll: () => Promise<void>;
  onCopySummary: () => Promise<void>;
  onOpenFolder: () => Promise<void>;
  aiSummary: Summary | null;
  summaryStatus:
    | "idle"
    | "processing"
    | "summarizing"
    | "regenerating"
    | "completed"
    | "error";
  transcripts: Transcript[];
  modelConfig: ModelConfig;
  setModelConfig: (
    config: ModelConfig | ((prev: ModelConfig) => ModelConfig),
  ) => void;
  onSaveModelConfig: (config?: ModelConfig) => Promise<void>;
  onGenerateSummary: (customPrompt: string) => Promise<void>;
  onStopGeneration: () => void;
  customPrompt: string;
  summaryResponse: SummaryResponse | null;
  onSaveSummary: (summary: Summary | { markdown: string }) => Promise<void>;
  onSummaryChange: (summary: Summary) => void;
  onDirtyChange: (isDirty: boolean) => void;
  summaryError: string | null;
  onRegenerateSummary: () => Promise<void>;
  getSummaryStatusMessage: (
    status:
      | "idle"
      | "processing"
      | "summarizing"
      | "regenerating"
      | "completed"
      | "error",
  ) => string;
  availableTemplates: Array<{ id: string; name: string; description: string }>;
  selectedTemplate: string;
  onTemplateSelect: (templateId: string, templateName: string) => void;
  isModelConfigLoading?: boolean;
  onOpenModelSettings?: (openFn: () => void) => void;
}

export function SummaryPanel({
  meeting,
  meetingTitle,
  onTitleChange,
  isEditingTitle,
  onStartEditTitle,
  onFinishEditTitle,
  isTitleDirty,
  isSummaryDirty,
  summaryRef,
  isSaving,
  onSaveAll,
  onCopySummary,
  onOpenFolder,
  aiSummary,
  summaryStatus,
  transcripts,
  modelConfig,
  setModelConfig,
  onSaveModelConfig,
  onGenerateSummary,
  onStopGeneration,
  customPrompt,
  summaryResponse,
  onSaveSummary,
  onSummaryChange,
  onDirtyChange,
  summaryError,
  onRegenerateSummary,
  getSummaryStatusMessage,
  availableTemplates,
  selectedTemplate,
  onTemplateSelect,
  isModelConfigLoading = false,
  onOpenModelSettings,
}: SummaryPanelProps) {
  const isSummaryLoading =
    summaryStatus === "processing" ||
    summaryStatus === "summarizing" ||
    summaryStatus === "regenerating";

  return (
    <div className="flex min-w-0 flex-1 flex-col overflow-hidden bg-background">
      {/* Title area */}
      <div className="border-b border-border p-4">
        {/* Identity strip — reinforces Parley's "everything stays on this
            machine" promise, with the meeting date. */}
        <div className="mb-3 flex items-center gap-2">
          <Badge variant="brand" dot>
            Local
          </Badge>
          {meeting.created_at && (
            <Badge variant="secondary">
              {new Date(meeting.created_at).toLocaleDateString(undefined, {
                year: "numeric",
                month: "short",
                day: "numeric",
              })}
            </Badge>
          )}
        </div>

        {/* <EditableTitle
          title={meetingTitle}
          isEditing={isEditingTitle}
          onStartEditing={onStartEditTitle}
          onFinishEditing={onFinishEditTitle}
          onChange={onTitleChange}
        /> */}

        {/* Calendar event link / metadata */}
        <div className="mb-3">
          <CalendarEventPanel
            meetingId={meeting.id}
            meetingCreatedAt={meeting.created_at}
          />
        </div>

        {/* Export stays reachable before a summary exists: a transcript-only
            meeting is still worth handing to another tool. With a summary it
            lives in the button row below instead, next to the other actions. */}
        {!aiSummary && !isSummaryLoading && (
          <div className="flex justify-end">
            <ExportMenu meetingId={meeting.id} />
          </div>
        )}

        {/* Button groups - only show when summary exists */}
        {aiSummary && !isSummaryLoading && (
          <div className="flex w-full items-center justify-center gap-2 pt-0">
            {/* Left-aligned: Summary Generator Button Group */}
            <div className="shrink-0">
              <SummaryGeneratorButtonGroup
                modelConfig={modelConfig}
                setModelConfig={setModelConfig}
                onSaveModelConfig={onSaveModelConfig}
                onGenerateSummary={onGenerateSummary}
                onStopGeneration={onStopGeneration}
                customPrompt={customPrompt}
                summaryStatus={summaryStatus}
                availableTemplates={availableTemplates}
                selectedTemplate={selectedTemplate}
                onTemplateSelect={onTemplateSelect}
                hasTranscripts={transcripts.length > 0}
                isModelConfigLoading={isModelConfigLoading}
                onOpenModelSettings={onOpenModelSettings}
              />
            </div>

            {/* Right-aligned: Summary Updater Button Group */}
            <div className="shrink-0">
              <SummaryUpdaterButtonGroup
                isSaving={isSaving}
                isDirty={isTitleDirty || isSummaryDirty}
                onSave={onSaveAll}
                onCopy={onCopySummary}
                onFind={() => {
                  // TODO: Implement find in summary functionality
                  console.log("Find in summary clicked");
                }}
                onOpenFolder={onOpenFolder}
                hasSummary={!!aiSummary}
              />
            </div>

            {/* Whole-meeting export (summary + action items + transcript) */}
            <div className="shrink-0">
              <ExportMenu meetingId={meeting.id} />
            </div>
          </div>
        )}
      </div>

      {isSummaryLoading ? (
        <div className="flex h-full flex-col">
          {/* Show button group during generation */}
          <div className="flex items-center justify-center pt-8 pb-4">
            <SummaryGeneratorButtonGroup
              modelConfig={modelConfig}
              setModelConfig={setModelConfig}
              onSaveModelConfig={onSaveModelConfig}
              onGenerateSummary={onGenerateSummary}
              onStopGeneration={onStopGeneration}
              customPrompt={customPrompt}
              summaryStatus={summaryStatus}
              availableTemplates={availableTemplates}
              selectedTemplate={selectedTemplate}
              onTemplateSelect={onTemplateSelect}
              hasTranscripts={transcripts.length > 0}
              isModelConfigLoading={isModelConfigLoading}
              onOpenModelSettings={onOpenModelSettings}
            />
          </div>
          {/* Loading spinner */}
          <div className="flex flex-1 items-center justify-center">
            <div className="text-center">
              <div className="
                mb-4 inline-block size-12 animate-spin rounded-full border-y-2
                border-info
              "></div>
              <p className="text-muted-foreground">Generating AI Summary...</p>
            </div>
          </div>
        </div>
      ) : !aiSummary ? (
        <div className="flex h-full flex-col">
          {/* Centered Summary Generator Button Group when no summary */}
          <div className="flex items-center justify-center pt-8 pb-4">
            <SummaryGeneratorButtonGroup
              modelConfig={modelConfig}
              setModelConfig={setModelConfig}
              onSaveModelConfig={onSaveModelConfig}
              onGenerateSummary={onGenerateSummary}
              onStopGeneration={onStopGeneration}
              customPrompt={customPrompt}
              summaryStatus={summaryStatus}
              availableTemplates={availableTemplates}
              selectedTemplate={selectedTemplate}
              onTemplateSelect={onTemplateSelect}
              hasTranscripts={transcripts.length > 0}
              isModelConfigLoading={isModelConfigLoading}
              onOpenModelSettings={onOpenModelSettings}
            />
          </div>
          {/* Empty state message */}
          <EmptyStateSummary
            onGenerate={() => onGenerateSummary(customPrompt)}
            hasModel={
              modelConfig.provider !== null && modelConfig.model !== null
            }
            isGenerating={isSummaryLoading}
          />

          {/* Action items still apply without a summary — the user may want to
              jot commitments down before (or instead of) generating one. */}
          <div className="px-6 pb-6">
            <ActionItemsPanel meetingId={meeting.id} hasSummary={false} />
          </div>
        </div>
      ) : (
        transcripts?.length > 0 && (
          <div className="min-h-0 flex-1 overflow-y-auto">
            {summaryResponse && (
              <div className="
                fixed inset-x-0 bottom-0 max-h-1/3 overflow-y-auto bg-background
                p-4 shadow-lg
              ">
                <Heading level={2} className="mb-2">Meeting Summary</Heading>
                <div className="grid grid-cols-2 gap-4">
                  <div className="rounded-lg bg-background p-4 shadow-sm">
                    <Heading level={3} className="mb-1">Key Points</Heading>
                    <ul className="list-disc pl-4">
                      {summaryResponse.summary.key_points.blocks.map(
                        (block, i) => (
                          <li key={i} className="text-sm">
                            {block.content}
                          </li>
                        ),
                      )}
                    </ul>
                  </div>
                  <div className="mt-4 rounded-lg bg-background p-4 shadow-sm">
                    <Heading level={3} className="mb-1">Action Items</Heading>
                    <ul className="list-disc pl-4">
                      {summaryResponse.summary.action_items.blocks.map(
                        (block, i) => (
                          <li key={i} className="text-sm">
                            {block.content}
                          </li>
                        ),
                      )}
                    </ul>
                  </div>
                  <div className="mt-4 rounded-lg bg-background p-4 shadow-sm">
                    <Heading level={3} className="mb-1">Decisions</Heading>
                    <ul className="list-disc pl-4">
                      {summaryResponse.summary.decisions.blocks.map(
                        (block, i) => (
                          <li key={i} className="text-sm">
                            {block.content}
                          </li>
                        ),
                      )}
                    </ul>
                  </div>
                  <div className="mt-4 rounded-lg bg-background p-4 shadow-sm">
                    <Heading level={3} className="mb-1">Main Topics</Heading>
                    <ul className="list-disc pl-4">
                      {summaryResponse.summary.main_topics.blocks.map(
                        (block, i) => (
                          <li key={i} className="text-sm">
                            {block.content}
                          </li>
                        ),
                      )}
                    </ul>
                  </div>
                </div>
                {summaryResponse.raw_summary ? (
                  <div className="mt-4">
                    <Heading level={3} className="mb-1">Full Summary</Heading>
                    <p className="text-sm whitespace-pre-wrap">
                      {summaryResponse.raw_summary}
                    </p>
                  </div>
                ) : null}
              </div>
            )}
            <div className="w-full p-6">
              <TiptapSummaryView
                ref={summaryRef}
                summaryData={aiSummary}
                onSave={onSaveSummary}
                onSummaryChange={onSummaryChange}
                onDirtyChange={onDirtyChange}
                status={summaryStatus}
                error={summaryError}
                onRegenerateSummary={onRegenerateSummary}
                meeting={{
                  id: meeting.id,
                  title: meetingTitle,
                  created_at: meeting.created_at,
                }}
              />
            </div>

            {/* Extracted + manual action items, as a checkable task list */}
            <div className="px-6 pb-6">
              <ActionItemsPanel meetingId={meeting.id} hasSummary={!!aiSummary} />
              <MeetingNotesPanel meetingId={meeting.id} />
            </div>
            {summaryStatus !== "idle" && (
              <Alert
                variant={
                  summaryStatus === "error"
                    ? "destructive"
                    : summaryStatus === "completed"
                      ? "success"
                      : "info"
                }
                className="mt-4"
              >
                <AlertDescription className="font-medium">
                  {getSummaryStatusMessage(summaryStatus)}
                </AlertDescription>
              </Alert>
            )}
          </div>
        )
      )}
    </div>
  );
}
