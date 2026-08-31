import { useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useComponents, useAllProjectComponents } from "@/hooks/useCoeData";
import { useAuth } from "@/contexts/AuthContext";
import { ComponentIcon } from "@/components/ComponentIcon";
import UserPicker from "@/components/UserPicker";
import AppLayout from "@/components/AppLayout";
import { ArrowLeft, ArrowRight, Check, Send, ExternalLink, X } from "lucide-react";
import { toast } from "sonner";
import {
  createProject,
  addProjectComponents,
  addProjectCollaborators,
  listBusinessUnits,
  listComplianceQuestions,
  type ProfileSummary,
} from "@/services/coeService";
import type { ComponentType } from "@/data/types";

const steps = [
  { label: "Components", description: "Select components" },
  { label: "Details", description: "Project information" },
  { label: "Questions", description: "Business information" },
  { label: "Review", description: "Review & create" },
];

const CreateProject = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { profile } = useAuth();
  const { data: components = [] } = useComponents();
  const { data: allProjectComponents = [] } = useAllProjectComponents();

  const preselectedComponents = [
    searchParams.get("component"),
    ...(searchParams.get("components")?.split(",") ?? []),
  ].filter((id): id is string => Boolean(id));
  const [step, setStep] = useState(0);
  const [selectedComponents, setSelectedComponents] = useState<string[]>(
    [...new Set(preselectedComponents)]
  );
  const [selectedCollaborators, setSelectedCollaborators] = useState<ProfileSummary[]>([]);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [businessUnitId, setBusinessUnitId] = useState("");
  const [answers, setAnswers] = useState<Record<string, string>>({});

  const tenantId = profile?.tenant_id;

  const { data: businessUnits = [] } = useQuery({
    queryKey: ["business-units-active", tenantId],
    queryFn: () => listBusinessUnits(tenantId!, { activeOnly: true }),
    enabled: !!tenantId,
  });

  const { data: complianceQuestions = [] } = useQuery({
    queryKey: ["compliance-questions-active", tenantId],
    queryFn: () => listComplianceQuestions(tenantId!, { activeOnly: true }),
    enabled: !!tenantId,
  });

  const assignedIds = new Set(allProjectComponents.map((pc) => pc.component_id));
  const unmanagedComponents = components.filter((c) => !assignedIds.has(c.id));

  const toggleComponent = (id: string) => {
    setSelectedComponents((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  };

  const addCollaborator = (user: ProfileSummary) => {
    setSelectedCollaborators((prev) => (prev.some((c) => c.id === user.id) ? prev : [...prev, user]));
  };

  const removeCollaborator = (id: string) => {
    setSelectedCollaborators((prev) => prev.filter((c) => c.id !== id));
  };

  const canProceed = () => {
    if (step === 0) return selectedComponents.length > 0;
    if (step === 1) return name.trim().length > 0 && description.trim().length > 0;
    if (step === 2) {
      const unitOk = businessUnits.length === 0 || Boolean(businessUnitId);
      const answersOk = complianceQuestions
        .filter((q) => q.required)
        .every((q) => answers[q.id]?.trim());
      return unitOk && answersOk;
    }
    return true;
  };

  const handleSubmit = async () => {
    if (!profile) return;

    const { data: project, error } = await createProject({
      tenant_id: profile.tenant_id,
      name: name.trim(),
      description: description.trim(),
      owner_id: profile.id,
      status: "draft",
      answers,
      business_unit_id: businessUnitId || null,
    });

    if (error || !project) {
      toast.error("Error: " + (error?.message || "Project create failed"));
      return;
    }

    if (selectedComponents.length > 0) {
      await addProjectComponents(
        selectedComponents.map((cid) => ({ project_id: project.id, component_id: cid }))
      );
    }

    if (selectedCollaborators.length > 0) {
      await addProjectCollaborators(
        selectedCollaborators.map((c) => ({ project_id: project.id, user_id: c.id }))
      );
    }

    toast.success("Project created successfully!");
    navigate(`/project/${project.id}`);
  };

  const selectedUnitName = businessUnits.find((u) => u.id === businessUnitId)?.name;
  const selectedCount = selectedComponents.length;

  return (
    <AppLayout>
      <div className="mx-auto flex h-[calc(100vh-4rem)] max-w-3xl -my-8 flex-col">
        <div className="shrink-0 space-y-4 border-b bg-background pb-4 pt-8">
          <div>
            <h1 className="text-3xl font-heading font-bold">Create Project</h1>
            <p className="text-muted-foreground mt-1">Bundle your components into a project</p>
          </div>

          <div className="flex items-center gap-2">
            {steps.map((s, i) => (
              <div key={i} className="flex items-center gap-2 flex-1">
                <div
                  className={`h-8 w-8 rounded-full flex items-center justify-center text-sm font-medium shrink-0 transition-colors ${
                    i < step
                      ? "bg-success text-success-foreground"
                      : i === step
                        ? "bg-primary text-primary-foreground"
                        : "bg-muted text-muted-foreground"
                  }`}
                >
                  {i < step ? <Check className="h-4 w-4" /> : i + 1}
                </div>
                <div className="hidden sm:block min-w-0">
                  <p
                    className={`text-xs font-medium truncate ${
                      i === step ? "text-foreground" : "text-muted-foreground"
                    }`}
                  >
                    {s.label}
                  </p>
                </div>
                {i < steps.length - 1 && <div className="flex-1 h-px bg-border" />}
              </div>
            ))}
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto py-6">
          {step === 0 && (
            <Card>
              <CardHeader>
                <CardTitle>Select Components</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {unmanagedComponents.map((comp) => (
                  <label
                    key={comp.id}
                    className={`flex items-center gap-4 p-3 rounded-lg border cursor-pointer transition-colors ${
                      selectedComponents.includes(comp.id)
                        ? "border-primary bg-primary/5"
                        : "hover:bg-muted/50"
                    }`}
                  >
                    <Checkbox
                      checked={selectedComponents.includes(comp.id)}
                      onCheckedChange={() => toggleComponent(comp.id)}
                    />
                    <ComponentIcon type={comp.type as ComponentType} size="sm" />
                    <div className="flex-1">
                      <p className="font-medium">{comp.name}</p>
                      <p className="text-sm text-muted-foreground">{comp.type}</p>
                    </div>
                    <a
                      href={comp.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <ExternalLink className="h-4 w-4 text-muted-foreground hover:text-foreground" />
                    </a>
                  </label>
                ))}
              </CardContent>
            </Card>
          )}

          {step === 1 && (
            <div className="space-y-6">
              <Card>
                <CardHeader>
                  <CardTitle>Project Details</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div>
                    <label className="text-sm font-medium mb-1.5 block">Name *</label>
                    <Input
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      placeholder="e.g. Sales Analytics Suite"
                    />
                  </div>
                  <div>
                    <label className="text-sm font-medium mb-1.5 block">Description *</label>
                    <Textarea
                      value={description}
                      onChange={(e) => setDescription(e.target.value)}
                      placeholder="Brief description of the project..."
                      rows={3}
                    />
                  </div>
                </CardContent>
              </Card>
              <Card>
                <CardHeader>
                  <CardTitle>Collaborators</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <UserPicker
                    className="w-full"
                    triggerLabel="Add a colleague from your directory..."
                    excludeIds={[...selectedCollaborators.map((c) => c.id), profile?.id ?? ""]}
                    onSelect={addCollaborator}
                  />
                  {selectedCollaborators.length > 0 && (
                    <div className="space-y-2">
                      {selectedCollaborators.map((col) => (
                        <div
                          key={col.id}
                          className="flex items-center gap-3 p-2 rounded-lg border bg-muted/30"
                        >
                          <div className="h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center text-xs font-medium text-primary shrink-0">
                            {col.full_name
                              .split(" ")
                              .map((n) => n[0])
                              .join("")
                              .slice(0, 2)}
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="font-medium text-sm truncate">{col.full_name}</p>
                            <p className="text-xs text-muted-foreground truncate">{col.email}</p>
                          </div>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7 text-muted-foreground hover:text-destructive"
                            onClick={() => removeCollaborator(col.id)}
                          >
                            <X className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>
          )}

          {step === 2 && (
            <Card>
              <CardHeader>
                <CardTitle>Business Information</CardTitle>
              </CardHeader>
              <CardContent className="space-y-5">
                {businessUnits.length > 0 && (
                  <div>
                    <label className="text-sm font-medium mb-1.5 block">Business unit *</label>
                    <Select value={businessUnitId} onValueChange={setBusinessUnitId}>
                      <SelectTrigger>
                        <SelectValue placeholder="Please select..." />
                      </SelectTrigger>
                      <SelectContent>
                        {businessUnits.map((u) => (
                          <SelectItem key={u.id} value={u.id}>
                            {u.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                )}
                {complianceQuestions.map((q) => (
                  <div key={q.id}>
                    <label className="text-sm font-medium mb-1.5 block">
                      {q.prompt}
                      {q.required && " *"}
                    </label>
                    {q.answer_type === "select" ? (
                      <Select
                        value={answers[q.id] || ""}
                        onValueChange={(val) => setAnswers((prev) => ({ ...prev, [q.id]: val }))}
                      >
                        <SelectTrigger>
                          <SelectValue placeholder="Please select..." />
                        </SelectTrigger>
                        <SelectContent>
                          {(q.options || []).map((opt) => (
                            <SelectItem key={opt} value={opt}>
                              {opt}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    ) : (
                      <Input
                        value={answers[q.id] || ""}
                        onChange={(e) =>
                          setAnswers((prev) => ({ ...prev, [q.id]: e.target.value }))
                        }
                      />
                    )}
                  </div>
                ))}
                {businessUnits.length === 0 &&
                  complianceQuestions.length === 0 && (
                  <p className="text-sm text-muted-foreground">
                    No business units or compliance questions are configured. An admin can add
                    them under Admin Settings → Company.
                  </p>
                )}
              </CardContent>
            </Card>
          )}

          {step === 3 && (
            <div className="space-y-6">
              <Card>
                <CardHeader>
                  <CardTitle>Summary</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div>
                    <p className="text-sm text-muted-foreground">Project Name</p>
                    <p className="font-medium">{name}</p>
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">Description</p>
                    <p>{description}</p>
                  </div>
                  {selectedUnitName && (
                    <div>
                      <p className="text-sm text-muted-foreground">Business unit</p>
                      <p className="font-medium">{selectedUnitName}</p>
                    </div>
                  )}
                  <div>
                    <p className="text-sm text-muted-foreground mb-2">
                      Components ({selectedComponents.length})
                    </p>
                    <div className="flex flex-wrap gap-2">
                      {selectedComponents.map((id) => {
                        const comp = components.find((c) => c.id === id);
                        if (!comp) return null;
                        return (
                          <div
                            key={id}
                            className="flex items-center gap-2 bg-muted rounded-lg px-3 py-1.5"
                          >
                            <ComponentIcon type={comp.type as ComponentType} size="sm" />
                            <span className="text-sm font-medium">{comp.name}</span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </CardContent>
              </Card>
            </div>
          )}
        </div>

        <div className="shrink-0 border-t bg-background pb-8 pt-4 shadow-[0_-4px_12px_-4px_rgba(0,0,0,0.08)]">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <Button
              variant="outline"
              onClick={() => (step === 0 ? navigate("/") : setStep(step - 1))}
              className="gap-2"
            >
              <ArrowLeft className="h-4 w-4" />
              {step === 0 ? "Cancel" : "Back"}
            </Button>
            {step === 0 && (
              <p className="order-last w-full text-center text-sm text-muted-foreground sm:order-none sm:w-auto sm:flex-1">
                {selectedCount === 1
                  ? "1 component selected"
                  : `${selectedCount} components selected`}
              </p>
            )}
            {step < 3 ? (
              <Button onClick={() => setStep(step + 1)} disabled={!canProceed()} className="gap-2">
                Next <ArrowRight className="h-4 w-4" />
              </Button>
            ) : (
              <Button onClick={handleSubmit} className="gap-2">
                <Send className="h-4 w-4" />
                Setup Project
              </Button>
            )}
          </div>
        </div>
      </div>
    </AppLayout>
  );
};

export default CreateProject;
