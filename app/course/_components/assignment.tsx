import React, { useEffect, useRef, useState } from 'react';
import { useSession } from 'next-auth/react';
import { AssignmentProvider } from '@/lib/contexts/AssignmentContext';
import AssignmentCreateModal from './assignment/assignment-create-modal';
import AssignmentDetailModal from './assignment/assignment-detail-modal';
import { GradingModal } from './assignment/GradingModal';
import { PlagiarismModal } from './assignment/PlagiarismModal';
import { AutoGradingModal } from './assignment/AutoGradingModal';
import { AssignmentHeader } from './assignment/AssignmentHeader';
import { AssignmentGrid } from './assignment/AssignmentGrid';
import { EmptyState } from './assignment/EmptyState';
import { LoadingSpinner } from './assignment/LoadingSpinner';
import { useAssignmentData, Assignment } from '../../../hooks/useAssignmentData';
import { useAssignmentActions } from '../../../hooks/useAssignmentActions';
import { filterAssignments } from '../../../lib/assignmentUtils';

interface AssignmentTabProps {
  courseCode: string;
  sessionId: number;
  initialAssignmentId?: number | null;
}

export default function AssignmentTab({ courseCode, sessionId, initialAssignmentId }: AssignmentTabProps) {
  const { data: session } = useSession();

  const [viewMode, setViewMode] = useState<'all' | 'by-session'>('all');
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [showDetailModal, setShowDetailModal] = useState(false);
  const [showGradingModal, setShowGradingModal] = useState(false);
  const [showPlagiarismModal, setShowPlagiarismModal] = useState(false);
  const [showAutoGradingModal, setShowAutoGradingModal] = useState(false);
  const [selectedAssignment, setSelectedAssignment] = useState<Assignment | null>(null);
  const [featureAccess, setFeatureAccess] = useState<{ ai_grading: boolean; plagiarism: boolean } | null>(null);

  // Custom hooks
  const { assignments, loading, refetch } = useAssignmentData(courseCode);
  const { handlePublishToggle, handleBulkPublish, handleSubmitAnswer } = useAssignmentActions(courseCode, refetch);

  const isTeacher = session?.user?.role?.toUpperCase() === 'TEACHER' || session?.user?.role?.toUpperCase() === 'GURU';
  const currentUserId = session?.user?.id ? parseInt(session.user.id) : null;
  const filteredAssignments = filterAssignments(assignments, isTeacher);

  // Load per-course feature access (admin "Manage Access Scopes" toggles).
  useEffect(() => {
    let cancelled = false;
    fetch(`/api/courses/${courseCode}/feature-access`)
      .then(res => res.json())
      .then(data => {
        if (!cancelled && data.success) setFeatureAccess(data.data);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [courseCode]);

  // Deep-link: when navigating in with ?assignmentId=N, auto-open that assignment's detail.
  // Only fire once per id, after assignments load.
  const openedDeepLinkRef = useRef<number | null>(null);
  useEffect(() => {
    if (!initialAssignmentId) return;
    if (loading) return;
    if (openedDeepLinkRef.current === initialAssignmentId) return;
    const target = assignments.find(a => a.id === initialAssignmentId);
    if (target) {
      setSelectedAssignment(target);
      setShowDetailModal(true);
      openedDeepLinkRef.current = initialAssignmentId;
    }
  }, [initialAssignmentId, assignments, loading]);

  const handleAssignmentClick = (assignment: Assignment) => {
    setSelectedAssignment(assignment);
    setShowDetailModal(true);
  };

  const handleEditClick = (assignment: Assignment, e: React.MouseEvent) => {
    e.stopPropagation();
    setSelectedAssignment(assignment);
    setShowEditModal(true);
  };

  const handlePublishToggleWrapper = async (assignment: Assignment, e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await handlePublishToggle(assignment);
    } catch (error) {
      alert(
        `Failed to ${assignment.is_published ? 'unpublish' : 'publish'} assignment: ${
          error instanceof Error ? error.message : 'Unknown error'
        }`
      );
    }
  };

  const handleGradeClick = (assignment: Assignment, e: React.MouseEvent) => {
    e.stopPropagation();
    setSelectedAssignment(assignment);
    setShowGradingModal(true);
  };

  const handlePlagiarismClick = (assignment: Assignment, e: React.MouseEvent) => {
    e.stopPropagation();
    setSelectedAssignment(assignment);
    setShowPlagiarismModal(true);
  };

  const handleAutoGradeClick = (assignment: Assignment, e: React.MouseEvent) => {
    e.stopPropagation();
    setSelectedAssignment(assignment);
    setShowAutoGradingModal(true);
  };

  const handleBulkPublishWrapper = async (publish: boolean) => {
    await handleBulkPublish(assignments, publish);
  };

  const handleSubmitAnswerWrapper = async (answers: any[]) => {
    if (!selectedAssignment || !currentUserId) return;

    try {
      await handleSubmitAnswer(selectedAssignment, answers, currentUserId);
      await refetch(); // Refresh to get updated submission data
    } catch (error) {
      console.error('Error submitting assignment:', error);
      throw error;
    }
  };

  const handleCreateSuccess = () => {
    refetch();
  };

  const handleEditSuccess = () => {
    refetch();
    setShowEditModal(false);
    setSelectedAssignment(null);
  };

  if (loading) {
    return <LoadingSpinner />;
  }

  return (
    <AssignmentProvider>
      <div className="space-y-6">
        <AssignmentHeader
          filteredAssignments={filteredAssignments}
          assignments={assignments}
          isTeacher={isTeacher}
          viewMode={viewMode}
          onViewModeChange={setViewMode}
          onCreateClick={() => setShowCreateModal(true)}
          onBulkPublish={handleBulkPublishWrapper}
        />

        {filteredAssignments.length === 0 ? (
          <EmptyState isTeacher={isTeacher} onCreateClick={isTeacher ? () => setShowCreateModal(true) : undefined} />
        ) : (
          <AssignmentGrid
            assignments={filteredAssignments}
            viewMode={viewMode}
            isTeacher={isTeacher}
            currentUserId={currentUserId || undefined}
            onAssignmentClick={handleAssignmentClick}
            onEditClick={handleEditClick}
            onPublishToggle={handlePublishToggleWrapper}
            onGradeClick={isTeacher ? handleGradeClick : undefined}
            onPlagiarismClick={isTeacher ? handlePlagiarismClick : undefined}
            onAutoGradeClick={isTeacher ? handleAutoGradeClick : undefined}
            aiGradingEnabled={featureAccess?.ai_grading ?? false}
            plagiarismEnabled={featureAccess?.plagiarism ?? false}
          />
        )}

        <AssignmentCreateModal
          sessionId={sessionId}
          courseCode={courseCode}
          isOpen={showCreateModal}
          onClose={() => setShowCreateModal(false)}
          onSuccess={handleCreateSuccess}
        />

        <AssignmentCreateModal
          sessionId={sessionId}
          courseCode={courseCode}
          isOpen={showEditModal}
          onClose={() => {
            setShowEditModal(false);
            setSelectedAssignment(null);
          }}
          onSuccess={handleEditSuccess}
          editAssignment={selectedAssignment}
        />

        <AssignmentDetailModal
          assignment={selectedAssignment}
          isOpen={showDetailModal}
          onClose={() => {
            setShowDetailModal(false);
            setSelectedAssignment(null);
          }}
          isTeacher={isTeacher}
          currentUserId={currentUserId || undefined}
          onSubmitAnswer={handleSubmitAnswerWrapper}
          onEdit={assignment => {
            setShowDetailModal(false);
            setSelectedAssignment(assignment);
            setShowEditModal(true);
          }}
        />

        {isTeacher && selectedAssignment && (
          <GradingModal
            assignment={selectedAssignment}
            courseCode={courseCode}
            sessionId={sessionId.toString()}
            isOpen={showGradingModal}
            onClose={() => {
              setShowGradingModal(false);
              setSelectedAssignment(null);
            }}
          />
        )}

        {isTeacher && selectedAssignment && (
          <PlagiarismModal
            assignment={selectedAssignment}
            isOpen={showPlagiarismModal}
            onClose={() => {
              setShowPlagiarismModal(false);
              setSelectedAssignment(null);
            }}
          />
        )}

        {isTeacher && selectedAssignment && (
          <AutoGradingModal
            assignment={selectedAssignment}
            courseCode={courseCode}
            isOpen={showAutoGradingModal}
            onClose={() => {
              setShowAutoGradingModal(false);
              setSelectedAssignment(null);
            }}
          />
        )}
      </div>
    </AssignmentProvider>
  );
}
