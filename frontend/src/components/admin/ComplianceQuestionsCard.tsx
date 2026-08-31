import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ArrowDown, ArrowUp, ClipboardList } from "lucide-react";
import { toast } from "sonner";
import {
  listComplianceQuestions,
  createComplianceQuestion,
  updateComplianceQuestion,
  deactivateComplianceQuestion,
  type ComplianceQuestion,
} from "@/services/coeService";

export default function ComplianceQuestionsCard({ tenantId }: { tenantId: string }) {
  const queryClient = useQueryClient();
  const [prompt, setPrompt] = useState("");
  const [answerType, setAnswerType] = useState<"text" | "select">("select");
  const [optionsText, setOptionsText] = useState("");
  const [required, setRequired] = useState(true);
  const [busy, setBusy] = useState(false);

  const { data: questions = [], isLoading } = useQuery({
    queryKey: ["compliance-questions", tenantId],
    queryFn: () => listComplianceQuestions(tenantId),
    enabled: !!tenantId,
  });

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ["compliance-questions", tenantId] });
  };

  const handleAdd = async () => {
    if (!prompt.trim()) return;
    const options =
      answerType === "select"
        ? optionsText
            .split(",")
            .map((o) => o.trim())
            .filter(Boolean)
        : [];
    if (answerType === "select" && options.length === 0) {
      toast.error("Add at least one option (comma-separated)");
      return;
    }
    setBusy(true);
    const { error } = await createComplianceQuestion(tenantId, {
      prompt: prompt.trim(),
      answer_type: answerType,
      options,
      required,
      sort_order: questions.length,
    });
    setBusy(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    setPrompt("");
    setOptionsText("");
    toast.success("Question added");
    refresh();
  };

  const move = async (q: ComplianceQuestion, dir: -1 | 1) => {
    const ordered = [...questions].sort((a, b) => a.sort_order - b.sort_order);
    const idx = ordered.findIndex((x) => x.id === q.id);
    const swap = ordered[idx + dir];
    if (!swap) return;
    setBusy(true);
    await updateComplianceQuestion(tenantId, q.id, { sort_order: swap.sort_order });
    await updateComplianceQuestion(tenantId, swap.id, { sort_order: q.sort_order });
    setBusy(false);
    refresh();
  };

  const toggleActive = async (q: ComplianceQuestion) => {
    setBusy(true);
    const { error } = q.is_active
      ? await deactivateComplianceQuestion(tenantId, q.id)
      : await updateComplianceQuestion(tenantId, q.id, { is_active: true });
    setBusy(false);
    if (error) toast.error(error.message);
    else refresh();
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <ClipboardList className="h-5 w-5" /> Compliance Questions
        </CardTitle>
        <p className="text-sm text-muted-foreground">
          Shown under Business Information when creating a project. Deactivate instead of deleting so
          older answers still resolve.
        </p>
      </CardHeader>
      <CardContent className="space-y-6 max-w-2xl">
        {isLoading ? (
          <p className="text-sm text-muted-foreground">Loading...</p>
        ) : (
          <div className="space-y-3">
            {questions.map((q) => (
              <div
                key={q.id}
                className={`p-3 rounded-md border space-y-2 ${
                  q.is_active ? "bg-muted/30" : "opacity-60 bg-muted/10"
                }`}
              >
                <div className="flex items-start gap-2">
                  <div className="flex flex-col">
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="h-6 w-6"
                      disabled={busy}
                      onClick={() => move(q, -1)}
                    >
                      <ArrowUp className="h-3 w-3" />
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="h-6 w-6"
                      disabled={busy}
                      onClick={() => move(q, 1)}
                    >
                      <ArrowDown className="h-3 w-3" />
                    </Button>
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-sm">{q.prompt}</p>
                    <p className="text-xs text-muted-foreground">
                      {q.answer_type}
                      {q.required ? " · required" : ""}
                      {q.answer_type === "select" && q.options?.length
                        ? ` · ${q.options.join(", ")}`
                        : ""}
                    </p>
                  </div>
                  <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => toggleActive(q)}>
                    {q.is_active ? "Deactivate" : "Activate"}
                  </Button>
                </div>
              </div>
            ))}
            {questions.length === 0 && (
              <p className="text-sm text-muted-foreground">No compliance questions yet.</p>
            )}
          </div>
        )}

        <div className="space-y-3 border-t pt-4">
          <Label>Add question</Label>
          <Input
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder="Question text"
          />
          <div className="flex flex-wrap gap-4 items-center">
            <Select value={answerType} onValueChange={(v) => setAnswerType(v as "text" | "select")}>
              <SelectTrigger className="w-40">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="select">Select</SelectItem>
                <SelectItem value="text">Free text</SelectItem>
              </SelectContent>
            </Select>
            <label className="flex items-center gap-2 text-sm">
              <Checkbox checked={required} onCheckedChange={(v) => setRequired(Boolean(v))} />
              Required
            </label>
          </div>
          {answerType === "select" && (
            <Input
              value={optionsText}
              onChange={(e) => setOptionsText(e.target.value)}
              placeholder="Options, comma-separated (e.g. Yes, No, Not sure)"
            />
          )}
          <Button onClick={handleAdd} disabled={busy || !prompt.trim()}>
            Add question
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
