import React from 'react';
import { Assignment } from '../../../../hooks/useAssignmentData';
import {
  getAssignmentStatus,
  getUserSubmission,
  formatDateTime,
  getScoreDisplay,
  getSubmissionStatusColor,
} from '../../../../lib/assignmentUtils';
import {
  FaEdit,
  FaGlobe,
  FaEye,
  FaClock,
  FaUsers,
  FaCheckCircle,
  FaHourglassHalf,
  FaShieldAlt,
  FaRobot,
  FaGraduationCap,
  FaLock,
} from 'react-icons/fa';

interface AssignmentCardProps {
  assignment: Assignment;
  isTeacher: boolean;
  currentUserId?: number;
  onAssignmentClick: (assignment: Assignment) => void;
  onEditClick: (assignment: Assignment, e: React.MouseEvent) => void;
  onPublishToggle: (assignment: Assignment, e: React.MouseEvent) => void;
  onGradeClick?: (assignment: Assignment, e: React.MouseEvent) => void;
  onPlagiarismClick?: (assignment: Assignment, e: React.MouseEvent) => void;
  onAutoGradeClick?: (assignment: Assignment, e: React.MouseEvent) => void;
}

const getStatusIcon = (iconName: string) => {
  switch (iconName) {
    case 'edit':
      return <FaEdit className="text-orange-600 mr-1" size={11} />;
    case 'eye':
      return <FaEye className="text-blue-600 mr-1" size={11} />;
    case 'clock':
      return <FaClock className="text-red-600 mr-1" size={11} />;
    case 'globe':
      return <FaGlobe className="text-green-600 mr-1" size={11} />;
    default:
      return <FaEye className="text-gray-600 mr-1" size={11} />;
  }
};

export const AssignmentCard = ({
  assignment,
  isTeacher,
  currentUserId,
  onAssignmentClick,
  onEditClick,
  onPublishToggle,
  onGradeClick,
  onPlagiarismClick,
  onAutoGradeClick,
}: AssignmentCardProps) => {
  const status = getAssignmentStatus(assignment, isTeacher, currentUserId);
  const userSubmission = currentUserId ? getUserSubmission(assignment, currentUserId) : null;

  // Teacher submission stats
  const totalSubmissions = assignment.submissions?.length ?? 0;
  const gradedSubmissions = assignment.submissions?.filter(
    (s: any) => s.graded_at !== null && s.graded_at !== undefined
  ).length ?? 0;
  const pendingSubmissions = totalSubmissions - gradedSubmissions;
  const hasSubmissions = totalSubmissions > 0;

  return (
    <div className="bg-white rounded-xl border border-gray-200 hover:shadow-md transition-shadow flex flex-col">

      {/* Clickable main body */}
      <div
        onClick={() => onAssignmentClick(assignment)}
        className="p-5 cursor-pointer flex-1"
      >
        {/* Status badge */}
        <div className="flex items-center justify-between mb-3">
          <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold ${status.bg} ${status.color}`}>
            {getStatusIcon(status.iconName)}
            {status.text}
          </span>
          {assignment.due_date && (
            <span className="flex items-center gap-1 text-xs text-gray-400">
              <FaClock size={10} />
              {formatDateTime(assignment.due_date)}
            </span>
          )}
        </div>

        {/* Title */}
        <h3 className="text-base font-semibold text-gray-900 mb-1 leading-snug line-clamp-2">
          {assignment.title}
        </h3>

        {/* Description */}
        {assignment.description && (
          <p className="text-gray-500 text-sm mb-3 line-clamp-2">{assignment.description}</p>
        )}

        {/* Session + Points row */}
        <div className="flex items-center justify-between text-xs text-gray-400 mb-3">
          {assignment.session_title ? (
            <span>Session: {assignment.session_title}</span>
          ) : <span />}
          <span className="font-medium text-gray-600">{assignment.total_points} pts</span>
        </div>

        {/* ── TEACHER: submission stats ── */}
        {isTeacher && (
          <div className="flex items-center gap-3 mt-2 pt-3 border-t border-gray-100">
            <div className="flex items-center gap-1.5 text-xs text-gray-500">
              <FaUsers size={11} className="text-gray-400" />
              <span><strong className="text-gray-700">{totalSubmissions}</strong> submitted</span>
            </div>
            {hasSubmissions && (
              <>
                <div className="flex items-center gap-1.5 text-xs text-green-600">
                  <FaCheckCircle size={11} />
                  <span><strong>{gradedSubmissions}</strong> graded</span>
                </div>
                {pendingSubmissions > 0 && (
                  <div className="flex items-center gap-1.5 text-xs text-amber-600">
                    <FaHourglassHalf size={11} />
                    <span><strong>{pendingSubmissions}</strong> pending</span>
                  </div>
                )}
              </>
            )}
            {!hasSubmissions && (
              <span className="text-xs text-gray-400 italic">No submissions yet</span>
            )}
          </div>
        )}

        {/* ── STUDENT: submission status ── */}
        {!isTeacher && userSubmission && (
          <div className="mt-3 pt-3 border-t border-gray-100">
            {(() => {
              const scoreInfo = getScoreDisplay(userSubmission.total_score, assignment.total_points, assignment);
              if (scoreInfo.status === 'pending') {
                return (
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-gray-500">Your submission</span>
                    <span className="text-xs text-amber-700 bg-amber-50 px-2 py-1 rounded-full font-medium">
                      ⏳ Awaiting grade
                    </span>
                  </div>
                );
              }
              if (scoreInfo.status === 'partial') {
                return (
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-gray-500">{scoreInfo.raw}</span>
                    <span className="text-xs text-blue-700 bg-blue-50 px-2 py-1 rounded-full">📝 Partially graded</span>
                  </div>
                );
              }
              return (
                <div className="flex items-center justify-between">
                  <span className="text-sm font-semibold text-gray-800">{scoreInfo.raw}</span>
                  <span className={`text-xs px-2 py-1 rounded-full font-medium
                    ${getSubmissionStatusColor(userSubmission.total_score, assignment.total_points, scoreInfo.status).bg}
                    ${getSubmissionStatusColor(userSubmission.total_score, assignment.total_points, scoreInfo.status).color}`}>
                    {scoreInfo.percentage} — {scoreInfo.letterGrade}
                  </span>
                </div>
              );
            })()}
          </div>
        )}
      </div>

      {/* ── TEACHER ACTION BAR (always visible) ── */}
      {isTeacher && (
        <div
          className="border-t border-gray-100 px-4 py-2.5 flex items-center gap-1 flex-wrap bg-gray-50 rounded-b-xl"
          onClick={e => e.stopPropagation()}
        >
          {/* Edit */}
          <button
            onClick={e => onEditClick(assignment, e)}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-gray-600 bg-white border border-gray-200 rounded-lg hover:bg-blue-50 hover:text-blue-700 hover:border-blue-200 transition-colors"
          >
            <FaEdit size={11} /> Edit
          </button>

          {/* Publish / Unpublish */}
          <button
            onClick={e => onPublishToggle(assignment, e)}
            className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium border rounded-lg transition-colors ${
              assignment.is_published
                ? 'text-gray-600 bg-white border-gray-200 hover:bg-red-50 hover:text-red-700 hover:border-red-200'
                : 'text-gray-600 bg-white border-gray-200 hover:bg-green-50 hover:text-green-700 hover:border-green-200'
            }`}
          >
            {assignment.is_published ? <><FaLock size={11} /> Unpublish</> : <><FaGlobe size={11} /> Publish</>}
          </button>

          {/* Grade Essays — only if has submissions */}
          {onGradeClick && hasSubmissions && (
            <button
              onClick={e => onGradeClick(assignment, e)}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-purple-700 bg-purple-50 border border-purple-200 rounded-lg hover:bg-purple-100 transition-colors"
            >
              <FaGraduationCap size={11} /> Grade
            </button>
          )}

          {/* AI Grade */}
          {onAutoGradeClick && (
            <button
              onClick={e => onAutoGradeClick(assignment, e)}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-indigo-700 bg-indigo-50 border border-indigo-200 rounded-lg hover:bg-indigo-100 transition-colors"
            >
              <FaRobot size={11} /> AI Grade
            </button>
          )}

          {/* Check Plagiarism — only if has submissions */}
          {onPlagiarismClick && hasSubmissions && (
            <button
              onClick={e => onPlagiarismClick(assignment, e)}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-amber-700 bg-amber-50 border border-amber-200 rounded-lg hover:bg-amber-100 transition-colors"
            >
              <FaShieldAlt size={11} /> Check Plagiarism
            </button>
          )}
        </div>
      )}
    </div>
  );
};
