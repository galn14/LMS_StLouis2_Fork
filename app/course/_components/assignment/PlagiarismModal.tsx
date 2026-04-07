import React, { useState, useEffect, useCallback } from 'react';
import { Assignment } from '../../../../hooks/useAssignmentData';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import {
  FaShieldAlt,
  FaPlay,
  FaSpinner,
  FaArrowLeft,
  FaDownload,
  FaUser,
  FaCheck,
  FaTimes,
  FaChevronRight,
  FaExclamationTriangle,
  FaCheckCircle,
  FaExclamationCircle,
} from 'react-icons/fa';

interface PlagiarismModalProps {
  assignment: Assignment;
  isOpen: boolean;
  onClose: () => void;
}

interface StudentResult {
  student_id: string;
  student_name: string;
  submission_id: string;
  high_risk_count: number;
  medium_risk_count: number;
  low_risk_count: number;
  max_similarity: number;
}

interface SimilarityMatch {
  comparison_id: string;
  target_student_name: string;
  similarity_score: number;
  risk_level: 'HIGH' | 'MEDIUM' | 'LOW' | 'NONE';
  match_count: number;
}

interface ChunkMatch {
  source_chunk_id: string;
  target_chunk_id: string;
  similarity: number;
  source_text: string;
  target_text: string;
}

interface EvidenceData {
  comparison_id: string;
  source_student: string;
  target_student: string;
  source_content: string;
  target_content: string;
  overall_similarity: number;
  risk_level: string;
  matched_chunks: ChunkMatch[];
  flag_id: string | null;
  reviewed: boolean;
  is_false_positive: boolean;
  teacher_notes: string | null;
}

// Step 1 → Step 2 → Step 3
type Step = 'confirm' | 'results' | 'comparison';

function riskLabel(level: string, similarity: number) {
  const pct = Math.round(similarity * 100);
  if (level === 'HIGH') return { label: `${pct}% Similar — Likely Copied`, color: 'text-red-700', bg: 'bg-red-50 border-red-200', icon: <FaExclamationCircle className="text-red-500" /> };
  if (level === 'MEDIUM') return { label: `${pct}% Similar — Needs Review`, color: 'text-orange-700', bg: 'bg-orange-50 border-orange-200', icon: <FaExclamationTriangle className="text-orange-500" /> };
  if (level === 'LOW') return { label: `${pct}% Similar — Minor Overlap`, color: 'text-yellow-700', bg: 'bg-yellow-50 border-yellow-200', icon: <FaExclamationTriangle className="text-yellow-400" /> };
  return { label: `${pct}% Similar — No Issue`, color: 'text-green-700', bg: 'bg-green-50 border-green-200', icon: <FaCheckCircle className="text-green-500" /> };
}

export const PlagiarismModal = ({ assignment, isOpen, onClose }: PlagiarismModalProps) => {
  const [step, setStep] = useState<Step>('confirm');

  // Detection state
  const [detecting, setDetecting] = useState(false);
  const [detectionId, setDetectionId] = useState<string | null>(null);
  const [detectionStatus, setDetectionStatus] = useState<string | null>(null);
  const [detectionProgress, setDetectionProgress] = useState({ processed: 0, total: 0 });
  const [detectionError, setDetectionError] = useState<string | null>(null);

  // Results state
  const [results, setResults] = useState<StudentResult[]>([]);
  const [loadingResults, setLoadingResults] = useState(false);
  const [hasExistingResults, setHasExistingResults] = useState(false);

  // Comparison state
  const [selectedStudent, setSelectedStudent] = useState<StudentResult | null>(null);
  const [similarities, setSimilarities] = useState<SimilarityMatch[]>([]);
  const [loadingSimilarities, setLoadingSimilarities] = useState(false);
  const [selectedMatch, setSelectedMatch] = useState<SimilarityMatch | null>(null);
  const [evidence, setEvidence] = useState<EvidenceData | null>(null);
  const [loadingEvidence, setLoadingEvidence] = useState(false);

  // Flag state
  const [flagAction, setFlagAction] = useState('');
  const [flagNotes, setFlagNotes] = useState('');
  const [savingFlag, setSavingFlag] = useState(false);
  const [flagSaved, setFlagSaved] = useState(false);

  // Reset on open
  useEffect(() => {
    if (isOpen && assignment) {
      setStep('confirm');
      setDetecting(false);
      setDetectionId(null);
      setDetectionStatus(null);
      setDetectionError(null);
      setSelectedStudent(null);
      setEvidence(null);
      setFlagSaved(false);
      checkExistingResults();
    }
  }, [isOpen, assignment?.id]);

  // Poll detection progress
  useEffect(() => {
    if (!detectionId || detectionStatus === 'completed' || detectionStatus === 'failed') return;
    const interval = setInterval(async () => {
      try {
        const res = await fetch(`/api/plagiarism/status/${detectionId}`);
        const data = await res.json();
        setDetectionStatus(data.status);
        setDetectionProgress({ processed: data.processed_submissions || 0, total: data.total_submissions || 0 });
        if (data.status === 'completed') {
          setDetecting(false);
          loadResults();
        } else if (data.status === 'failed') {
          setDetecting(false);
          setDetectionError(data.error_message || 'Detection failed. Please try again.');
        }
      } catch { /* keep polling */ }
    }, 3000);
    return () => clearInterval(interval);
  }, [detectionId, detectionStatus]);

  const checkExistingResults = async () => {
    try {
      const res = await fetch(`/api/plagiarism/results/${assignment.id}`);
      const data = await res.json();
      if (Array.isArray(data) && data.length > 0) {
        const anyMatch = data.some(r => r.high_risk_count > 0 || r.medium_risk_count > 0 || r.low_risk_count > 0);
        setHasExistingResults(anyMatch);
        setResults(data);
      }
    } catch { /* ignore */ }
  };

  const loadResults = async () => {
    setLoadingResults(true);
    try {
      const res = await fetch(`/api/plagiarism/results/${assignment.id}`);
      const data = await res.json();
      if (Array.isArray(data)) {
        setResults(data);
        setStep('results');
      }
    } catch (err) {
      console.error('Failed to load results:', err);
    } finally {
      setLoadingResults(false);
    }
  };

  const startDetection = async () => {
    setDetecting(true);
    setDetectionStatus('processing');
    setDetectionError(null);
    setDetectionProgress({ processed: 0, total: 0 });
    try {
      const res = await fetch('/api/plagiarism/detect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ assignmentId: assignment.id.toString() }),
      });
      const data = await res.json();
      if (data.detectionId) {
        setDetectionId(data.detectionId);
      } else if (data.success !== false) {
        setDetecting(false);
        setDetectionStatus('completed');
        loadResults();
      } else {
        setDetecting(false);
        setDetectionError(data.error || 'Something went wrong. Please try again.');
      }
    } catch {
      setDetecting(false);
      setDetectionError('Connection error. Please try again.');
    }
  };

  const openStudentMatches = async (student: StudentResult) => {
    setSelectedStudent(student);
    setSelectedMatch(null);
    setEvidence(null);
    setStep('comparison');
    setLoadingSimilarities(true);
    try {
      const res = await fetch(`/api/plagiarism/similarities/${student.submission_id}`);
      const data = await res.json();
      setSimilarities(data.matches || []);
    } catch {
      setSimilarities([]);
    } finally {
      setLoadingSimilarities(false);
    }
  };

  const openEvidence = async (match: SimilarityMatch) => {
    setSelectedMatch(match);
    setFlagAction('');
    setFlagNotes('');
    setFlagSaved(false);
    setLoadingEvidence(true);
    try {
      const res = await fetch(`/api/plagiarism/evidence/${match.comparison_id}`);
      const data = await res.json();
      setEvidence(data);
    } catch {
      setEvidence(null);
    } finally {
      setLoadingEvidence(false);
    }
  };

  const saveFlag = async (isFalsePositive: boolean) => {
    if (!evidence?.flag_id) return;
    setSavingFlag(true);
    try {
      const res = await fetch('/api/plagiarism/flag', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          flag_id: evidence.flag_id,
          action: isFalsePositive ? 'marked_false_positive' : (flagAction || 'warning_sent'),
          notes: flagNotes,
          is_false_positive: isFalsePositive,
        }),
      });
      const data = await res.json();
      if (data.success) {
        setEvidence(prev => prev ? { ...prev, reviewed: true, is_false_positive: isFalsePositive, teacher_notes: flagNotes } : null);
        setFlagSaved(true);
      }
    } catch {
      alert('Failed to save. Please try again.');
    } finally {
      setSavingFlag(false);
    }
  };

  const goBack = useCallback(() => {
    if (step === 'comparison' && selectedMatch) {
      setSelectedMatch(null);
      setEvidence(null);
    } else if (step === 'comparison') {
      setStep('results');
      setSelectedStudent(null);
    } else if (step === 'results') {
      setStep('confirm');
    }
  }, [step, selectedMatch]);

  if (!isOpen) return null;

  // --- Bucket students by risk ---
  const highRiskStudents = results.filter(r => r.high_risk_count > 0);
  const mediumRiskStudents = results.filter(r => r.medium_risk_count > 0 && r.high_risk_count === 0);
  const cleanStudents = results.filter(r => r.high_risk_count === 0 && r.medium_risk_count === 0);
  const submissionCount = assignment.submissions?.length ?? 0;

  return (
    <Dialog open={isOpen} onOpenChange={open => !open && onClose()}>
      <DialogContent className="sm:max-w-[900px] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-lg">
            <FaShieldAlt className="text-amber-500" />
            Plagiarism Check
          </DialogTitle>
          <DialogDescription className="text-gray-500">
            {assignment.title}
          </DialogDescription>
        </DialogHeader>

        {/* Back button */}
        {step !== 'confirm' && (
          <button
            onClick={goBack}
            className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-700 mb-2 w-fit"
          >
            <FaArrowLeft size={11} /> Back
          </button>
        )}

        {/* ═══════════════════════════════════════════════
            STEP 1 — CONFIRM
        ═══════════════════════════════════════════════ */}
        {step === 'confirm' && (
          <div className="space-y-6 py-2">
            {/* Info box */}
            <div className="bg-amber-50 border border-amber-200 rounded-xl p-5">
              <div className="flex items-start gap-3">
                <FaShieldAlt className="text-amber-500 mt-0.5 shrink-0" size={20} />
                <div>
                  <h3 className="font-semibold text-amber-800 mb-1">How it works</h3>
                  <p className="text-sm text-amber-700 leading-relaxed">
                    The system will read all student essay answers, then compare every student&apos;s
                    work against each other to find similar writing. This usually takes
                    <strong> 1–3 minutes</strong> depending on the number of submissions.
                  </p>
                </div>
              </div>
            </div>

            {/* Stats */}
            <div className="grid grid-cols-2 gap-4">
              <div className="border rounded-xl p-4 text-center">
                <div className="text-3xl font-bold text-gray-800">{submissionCount}</div>
                <div className="text-sm text-gray-500 mt-1">Essays to check</div>
              </div>
              <div className="border rounded-xl p-4 text-center">
                <div className="text-3xl font-bold text-gray-800">{submissionCount > 1 ? `${submissionCount * (submissionCount - 1) / 2}` : '—'}</div>
                <div className="text-sm text-gray-500 mt-1">Pairs to compare</div>
              </div>
            </div>

            {submissionCount < 2 && (
              <div className="bg-gray-50 border border-gray-200 rounded-xl p-4 text-center text-sm text-gray-500">
                At least 2 student submissions are needed to run a plagiarism check.
              </div>
            )}

            {/* Existing results notice */}
            {hasExistingResults && (
              <div className="flex items-center justify-between bg-blue-50 border border-blue-200 rounded-xl p-4">
                <div>
                  <p className="text-sm font-medium text-blue-800">Previous results available</p>
                  <p className="text-xs text-blue-600 mt-0.5">You can view past results or run a fresh check.</p>
                </div>
                <Button variant="outline" size="sm" onClick={() => { loadResults(); }} className="ml-4 shrink-0">
                  View Past Results
                </Button>
              </div>
            )}

            {/* Error */}
            {detectionError && (
              <div className="bg-red-50 border border-red-200 rounded-xl p-4 text-sm text-red-700">
                ⚠️ {detectionError}
              </div>
            )}

            {/* Progress */}
            {detecting && (
              <div className="bg-blue-50 border border-blue-200 rounded-xl p-5">
                <div className="flex items-center gap-2 mb-3">
                  <FaSpinner className="animate-spin text-blue-600" />
                  <span className="font-medium text-blue-800">Checking for plagiarism...</span>
                </div>
                {detectionProgress.total > 0 && (
                  <>
                    <div className="w-full bg-blue-200 rounded-full h-2.5 mb-2">
                      <div
                        className="bg-blue-600 h-2.5 rounded-full transition-all duration-500"
                        style={{ width: `${Math.round((detectionProgress.processed / detectionProgress.total) * 100)}%` }}
                      />
                    </div>
                    <p className="text-xs text-blue-600">
                      Processing {detectionProgress.processed} of {detectionProgress.total} submissions…
                    </p>
                  </>
                )}
              </div>
            )}

            {/* Actions */}
            <div className="flex items-center gap-3 pt-2">
              <Button
                onClick={startDetection}
                disabled={detecting || submissionCount < 2}
                className="flex items-center gap-2 bg-amber-600 hover:bg-amber-700 text-white"
              >
                {detecting ? <FaSpinner className="animate-spin" size={13} /> : <FaPlay size={13} />}
                {detecting ? 'Running check…' : 'Start Plagiarism Check'}
              </Button>
              <Button variant="outline" onClick={onClose}>Cancel</Button>
            </div>
          </div>
        )}

        {/* ═══════════════════════════════════════════════
            STEP 2 — RESULTS
        ═══════════════════════════════════════════════ */}
        {step === 'results' && (
          <div className="space-y-6 py-2">
            {loadingResults ? (
              <div className="text-center py-12 text-gray-500">
                <FaSpinner className="animate-spin inline mb-2" size={24} />
                <p>Loading results…</p>
              </div>
            ) : (
              <>
                {/* Summary bar */}
                <div className="grid grid-cols-3 gap-3">
                  <div className="bg-red-50 border border-red-200 rounded-xl p-3 text-center">
                    <div className="text-2xl font-bold text-red-700">{highRiskStudents.length}</div>
                    <div className="text-xs text-red-600 mt-0.5">🚨 Likely Copied</div>
                  </div>
                  <div className="bg-orange-50 border border-orange-200 rounded-xl p-3 text-center">
                    <div className="text-2xl font-bold text-orange-700">{mediumRiskStudents.length}</div>
                    <div className="text-xs text-orange-600 mt-0.5">⚠️ Needs Review</div>
                  </div>
                  <div className="bg-green-50 border border-green-200 rounded-xl p-3 text-center">
                    <div className="text-2xl font-bold text-green-700">{cleanStudents.length}</div>
                    <div className="text-xs text-green-600 mt-0.5">✅ No Issues</div>
                  </div>
                </div>

                {/* Export */}
                <div className="flex justify-end">
                  <button
                    onClick={() => window.open(`/api/plagiarism/export/${assignment.id}`, '_blank')}
                    className="flex items-center gap-1.5 text-xs text-gray-500 hover:text-gray-700"
                  >
                    <FaDownload size={11} /> Download Report (CSV)
                  </button>
                </div>

                {/* 🚨 High risk group */}
                {highRiskStudents.length > 0 && (
                  <div>
                    <div className="flex items-center gap-2 mb-3">
                      <FaExclamationCircle className="text-red-500" />
                      <h3 className="font-semibold text-red-700">Likely Copied — Immediate Review Needed</h3>
                    </div>
                    <div className="space-y-2">
                      {highRiskStudents.sort((a, b) => b.max_similarity - a.max_similarity).map(s => (
                        <StudentResultRow key={s.submission_id} student={s} onClick={() => openStudentMatches(s)} />
                      ))}
                    </div>
                  </div>
                )}

                {/* ⚠️ Medium risk group */}
                {mediumRiskStudents.length > 0 && (
                  <div>
                    <div className="flex items-center gap-2 mb-3">
                      <FaExclamationTriangle className="text-orange-500" />
                      <h3 className="font-semibold text-orange-700">Suspicious — Worth Reviewing</h3>
                    </div>
                    <div className="space-y-2">
                      {mediumRiskStudents.sort((a, b) => b.max_similarity - a.max_similarity).map(s => (
                        <StudentResultRow key={s.submission_id} student={s} onClick={() => openStudentMatches(s)} />
                      ))}
                    </div>
                  </div>
                )}

                {/* ✅ Clean group */}
                {cleanStudents.length > 0 && (
                  <div>
                    <div className="flex items-center gap-2 mb-2">
                      <FaCheckCircle className="text-green-500" />
                      <h3 className="font-semibold text-green-700">No Issues Found</h3>
                    </div>
                    <div className="bg-green-50 border border-green-200 rounded-xl p-3">
                      <p className="text-sm text-green-700">
                        {cleanStudents.map(s => s.student_name).join(', ')}
                      </p>
                    </div>
                  </div>
                )}

                {results.length === 0 && (
                  <div className="text-center py-8 text-gray-500">No results found. Try running the check again.</div>
                )}
              </>
            )}
          </div>
        )}

        {/* ═══════════════════════════════════════════════
            STEP 3 — COMPARISON
        ═══════════════════════════════════════════════ */}
        {step === 'comparison' && (
          <div className="space-y-5 py-2">
            {/* Student header */}
            {selectedStudent && !selectedMatch && (
              <div className="bg-gray-50 rounded-xl p-4">
                <div className="flex items-center gap-2 mb-1">
                  <FaUser className="text-gray-400" size={14} />
                  <span className="font-semibold text-gray-800">{selectedStudent.student_name}</span>
                </div>
                <p className="text-sm text-gray-500">
                  Click on a match below to see the side-by-side comparison.
                </p>
              </div>
            )}

            {/* Match list */}
            {!selectedMatch && (
              <>
                {loadingSimilarities ? (
                  <div className="text-center py-8 text-gray-500">
                    <FaSpinner className="animate-spin inline mb-2" />
                    <p>Loading matches…</p>
                  </div>
                ) : similarities.length === 0 ? (
                  <div className="text-center py-8 text-gray-400">No matches found for this student.</div>
                ) : (
                  <div className="space-y-3">
                    {similarities.map(match => {
                      const risk = riskLabel(match.risk_level, match.similarity_score);
                      return (
                        <button
                          key={match.comparison_id}
                          onClick={() => openEvidence(match)}
                          className={`w-full text-left border rounded-xl p-4 hover:shadow-sm transition-shadow ${risk.bg}`}
                        >
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-3">
                              {risk.icon}
                              <div>
                                <p className="font-medium text-gray-800">{match.target_student_name}</p>
                                <p className={`text-sm font-semibold mt-0.5 ${risk.color}`}>{risk.label}</p>
                              </div>
                            </div>
                            <FaChevronRight className="text-gray-400 shrink-0" size={12} />
                          </div>
                        </button>
                      );
                    })}
                  </div>
                )}
              </>
            )}

            {/* Evidence panel */}
            {selectedMatch && (
              <>
                {loadingEvidence ? (
                  <div className="text-center py-8 text-gray-500">
                    <FaSpinner className="animate-spin inline mb-2" />
                    <p>Loading comparison…</p>
                  </div>
                ) : evidence ? (
                  <div className="space-y-5">
                    {/* Similarity summary */}
                    <div className={`rounded-xl p-4 border ${riskLabel(evidence.risk_level, evidence.overall_similarity).bg}`}>
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          {riskLabel(evidence.risk_level, evidence.overall_similarity).icon}
                          <div>
                            <p className="font-semibold text-gray-800">
                              {evidence.source_student} &amp; {evidence.target_student}
                            </p>
                            <p className={`text-sm font-semibold ${riskLabel(evidence.risk_level, evidence.overall_similarity).color}`}>
                              {riskLabel(evidence.risk_level, evidence.overall_similarity).label}
                            </p>
                          </div>
                        </div>
                        {evidence.reviewed && (
                          <span className={`text-xs px-3 py-1 rounded-full font-medium ${evidence.is_false_positive ? 'bg-gray-100 text-gray-600' : 'bg-green-100 text-green-700'}`}>
                            {evidence.is_false_positive ? '✓ Dismissed' : '✓ Reviewed'}
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Side-by-side texts */}
                    <div>
                      <h4 className="text-sm font-semibold text-gray-600 mb-2">Student Answers</h4>
                      <div className="grid grid-cols-2 gap-3">
                        <div className="rounded-xl border border-blue-200 overflow-hidden">
                          <div className="bg-blue-50 px-3 py-2 text-xs font-semibold text-blue-700 border-b border-blue-200">
                            {evidence.source_student}
                          </div>
                          <div className="p-3 text-sm leading-relaxed text-gray-700 max-h-48 overflow-y-auto whitespace-pre-wrap">
                            {evidence.source_content || 'No content'}
                          </div>
                        </div>
                        <div className="rounded-xl border border-orange-200 overflow-hidden">
                          <div className="bg-orange-50 px-3 py-2 text-xs font-semibold text-orange-700 border-b border-orange-200">
                            {evidence.target_student}
                          </div>
                          <div className="p-3 text-sm leading-relaxed text-gray-700 max-h-48 overflow-y-auto whitespace-pre-wrap">
                            {evidence.target_content || 'No content'}
                          </div>
                        </div>
                      </div>
                    </div>

                    {/* Matching sections */}
                    {evidence.matched_chunks && evidence.matched_chunks.length > 0 && (
                      <div>
                        <h4 className="text-sm font-semibold text-gray-600 mb-2">
                          Sections that match ({evidence.matched_chunks.length} found)
                        </h4>
                        <div className="space-y-2 max-h-56 overflow-y-auto pr-1">
                          {evidence.matched_chunks.map((chunk, i) => (
                            <div key={i} className="grid grid-cols-2 gap-2">
                              <div className="rounded-lg bg-blue-50 border border-blue-100 p-2.5 text-xs text-gray-700 leading-relaxed">
                                {chunk.source_text}
                              </div>
                              <div className="rounded-lg bg-orange-50 border border-orange-100 p-2.5 text-xs text-gray-700 leading-relaxed">
                                {chunk.target_text}
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Teacher decision panel */}
                    {evidence.flag_id && !evidence.reviewed && !flagSaved && (
                      <div className="border-t pt-5">
                        <h4 className="text-sm font-semibold text-gray-700 mb-3">What do you want to do?</h4>
                        <div className="space-y-3">
                          <textarea
                            value={flagNotes}
                            onChange={e => setFlagNotes(e.target.value)}
                            placeholder="Add a note (optional) — e.g. 'Students studied together' or 'Will send warning'"
                            className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-400 resize-none"
                            rows={2}
                          />
                          <div className="flex items-center gap-3">
                            <Button
                              onClick={() => saveFlag(false)}
                              disabled={savingFlag}
                              className="flex items-center gap-2 bg-red-600 hover:bg-red-700 text-white"
                            >
                              {savingFlag ? <FaSpinner className="animate-spin" size={12} /> : <FaExclamationCircle size={12} />}
                              Flag as Plagiarism
                            </Button>
                            <Button
                              variant="outline"
                              onClick={() => saveFlag(true)}
                              disabled={savingFlag}
                              className="flex items-center gap-2"
                            >
                              <FaTimes size={12} /> Dismiss — Not Plagiarism
                            </Button>
                          </div>
                        </div>
                      </div>
                    )}

                    {/* Already acted */}
                    {(evidence.reviewed || flagSaved) && (
                      <div className={`rounded-xl p-4 flex items-center gap-3 ${evidence.is_false_positive ? 'bg-gray-50 border border-gray-200' : 'bg-green-50 border border-green-200'}`}>
                        {evidence.is_false_positive ? <FaTimes className="text-gray-500" /> : <FaCheck className="text-green-600" />}
                        <div>
                          <p className="text-sm font-semibold text-gray-800">
                            {evidence.is_false_positive ? 'Dismissed as not plagiarism' : 'Flagged as plagiarism'}
                          </p>
                          {evidence.teacher_notes && (
                            <p className="text-xs text-gray-500 mt-0.5">Note: {evidence.teacher_notes}</p>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="text-center py-8 text-gray-400">Could not load comparison details.</div>
                )}
              </>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
};

// ── Sub-component: student result row ──────────────────────────
function StudentResultRow({ student, onClick }: { student: StudentResult; onClick: () => void }) {
  const pct = Math.round(student.max_similarity * 100);
  const isHigh = student.high_risk_count > 0;

  return (
    <button
      onClick={onClick}
      className={`w-full text-left border rounded-xl p-4 hover:shadow-sm transition-all flex items-center justify-between group
        ${isHigh ? 'bg-red-50 border-red-200 hover:border-red-400' : 'bg-orange-50 border-orange-200 hover:border-orange-400'}`}
    >
      <div className="flex items-center gap-3">
        <div className={`w-10 h-10 rounded-full flex items-center justify-center text-sm font-bold shrink-0
          ${isHigh ? 'bg-red-100 text-red-700' : 'bg-orange-100 text-orange-700'}`}>
          {pct}%
        </div>
        <div>
          <p className="font-semibold text-gray-800">{student.student_name}</p>
          <p className="text-xs text-gray-500 mt-0.5">
            {student.high_risk_count > 0 && `${student.high_risk_count} high-similarity match${student.high_risk_count > 1 ? 'es' : ''}`}
            {student.high_risk_count > 0 && student.medium_risk_count > 0 && ' · '}
            {student.medium_risk_count > 0 && `${student.medium_risk_count} medium match${student.medium_risk_count > 1 ? 'es' : ''}`}
          </p>
        </div>
      </div>
      <FaChevronRight className="text-gray-400 group-hover:text-gray-600 transition-colors shrink-0" size={13} />
    </button>
  );
}
