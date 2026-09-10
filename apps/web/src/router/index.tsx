import { createBrowserRouter, Navigate } from 'react-router-dom'
import { AppShell } from '../components/layout/AppShell'
import { AuthGuard } from '../components/layout/AuthGuard'
import { PlaceholderScreen } from '../components/layout/PlaceholderScreen'
import { SignIn }               from '../screens/shell/SignIn'
import { MFAVerify }            from '../screens/shell/MFAVerify'
import { TCGate }               from '../screens/shell/TCGate'
import { AllProjects }          from '../screens/shell/AllProjects'
import { ProjectDashboard }     from '../screens/shell/ProjectDashboard'
import { ClinicalWritingHome }  from '../screens/clinical-writing/ClinicalWritingHome'
import { DocumentEditor }       from '../screens/clinical-writing/DocumentEditor'
import { DiffView }             from '../screens/clinical-writing/DiffView'
import { ReviewerView }         from '../screens/clinical-writing/ReviewerView'
import { CommentsDashboard }    from '../screens/clinical-writing/CommentsDashboard'
import { CRMModule }            from '../screens/crm/CRMModule'
import { ESignature }           from '../screens/output/ESignature'
import { FinalDocument }        from '../screens/output/FinalDocument'
import { PortfolioDashboard }   from '../screens/output/PortfolioDashboard'
import { AuditReviewAlert }     from '../screens/output/AuditReviewAlert'
import { ScientificWritingHome } from '../screens/scientific-writing/ScientificWritingHome'
import { NewPublicationWizard } from '../screens/scientific-writing/NewPublicationWizard'
import { ManuscriptEditor }    from '../screens/scientific-writing/ManuscriptEditor'
import { AuthorManagement }    from '../screens/scientific-writing/AuthorManagement'
import { JournalSubmissionReadiness } from '../screens/scientific-writing/JournalSubmissionReadiness'
import { CongressAbstractExport } from '../screens/scientific-writing/CongressAbstractExport'
import { PeerReviewResponse }    from '../screens/scientific-writing/PeerReviewResponse'
import { FinalOutput }           from '../screens/scientific-writing/FinalOutput'
import { PortfolioDashboard as SciPortfolioDashboard } from '../screens/scientific-writing/PortfolioDashboard'
import { MedicalWritingHome } from '../screens/medical-writing/MedicalWritingHome'
import { ContentBriefing }   from '../screens/medical-writing/ContentBriefing'
import { KOLAdvisoryBoardSession } from '../screens/medical-writing/KOLAdvisoryBoardSession'
import { ContentEditor }         from '../screens/medical-writing/ContentEditor'
import { PreMLRCheckPanel }      from '../screens/medical-writing/PreMLRCheckPanel'
import { MLRReview }              from '../screens/medical-writing/MLRReview'
import { ClaimsMatrixPanel }      from '../screens/medical-writing/ClaimsMatrixPanel'
import { FormattingAccessibility } from '../screens/medical-writing/FormattingAccessibility'
import { FinalOutput as MedFinalOutput } from '../screens/medical-writing/FinalOutput'
import { ContentPortfolio }              from '../screens/medical-writing/ContentPortfolio'
import { RegulatoryWritingHome }         from '../screens/regulatory-writing/RegulatoryWritingHome'
import { SubmissionSetupStrategy }       from '../screens/regulatory-writing/SubmissionSetupStrategy'
import { ECTDGranularityMap }            from '../screens/regulatory-writing/ECTDGranularityMap'
import { CTDModule2Editor }              from '../screens/regulatory-writing/CTDModule2Editor'
import { CMCNonclinicalFinalisation }    from '../screens/regulatory-writing/CMCNonclinicalFinalisation'
import { SuperReview }                   from '../screens/regulatory-writing/SuperReview'
import { ECTDPublishingMonitor }         from '../screens/regulatory-writing/ECTDPublishingMonitor'
import { PPDCCIRedactionTool }           from '../screens/regulatory-writing/PPDCCIRedactionTool'
import { GatewaySubmission }             from '../screens/regulatory-writing/GatewaySubmission'
import { HAResponseDrafting }            from '../screens/regulatory-writing/HAResponseDrafting'
import { RegulatoryIntelligence }        from '../screens/regulatory-writing/RegulatoryIntelligence'
import { FinalOutputPortfolio }          from '../screens/regulatory-writing/FinalOutputPortfolio'
import { IdeationPublishingHome }        from '../screens/ideation-publishing/IdeationPublishingHome'
import { ArtefactUploadSourceCheck }    from '../screens/ideation-publishing/ArtefactUploadSourceCheck'
import { ContentCardTagging }           from '../screens/ideation-publishing/ContentCardTagging'
import { PreReviewComplianceScreen }    from '../screens/ideation-publishing/PreReviewComplianceScreen'
import { KOLReviewInterface }           from '../screens/ideation-publishing/KOLReviewInterface'
import { MedicalAffairsApproval }       from '../screens/ideation-publishing/MedicalAffairsApproval'
import { ContentCalendar }              from '../screens/ideation-publishing/ContentCalendar'
import { PublishingMonitor }            from '../screens/ideation-publishing/PublishingMonitor'
import { FinalOutputPublishingRecord }  from '../screens/ideation-publishing/FinalOutputPublishingRecord'
import { StandardsMetadataDOI }         from '../screens/ideation-publishing/StandardsMetadataDOI'

export const router = createBrowserRouter([
  // Auth screens — no shell
  { path: '/sign-in', element: <SignIn /> },
  { path: '/mfa',     element: <MFAVerify /> },
  { path: '/terms',   element: <TCGate /> },
  // Authenticated shell
  {
    path: '/',
    element: <AuthGuard><AppShell /></AuthGuard>,
    children: [
      { index: true, element: <Navigate to="/projects" replace /> },
      { path: 'projects',     element: <AllProjects /> },
      { path: 'projects/new', element: <PlaceholderScreen name="New Project (04)" /> },
      {
        path: 'projects/:projectId',
        children: [
          { index: true, element: <ProjectDashboard /> },
          {
            path: 'clinical-writing',
            children: [
              { index: true,          element: <ClinicalWritingHome /> },
              { path: 'new',          element: <PlaceholderScreen name="New Document (07)" /> },
              { path: 'classify',     element: <PlaceholderScreen name="Auto-Classification (08)" /> },
              { path: 'comments',     element: <CommentsDashboard /> },
              { path: 'portfolio',    element: <PortfolioDashboard /> },
              { path: 'audit-review', element: <AuditReviewAlert /> },
              { path: 'crm',          element: <CRMModule /> },
              {
                path: 'documents/:documentId',
                children: [
                  { index: true,      element: <DocumentEditor /> },
                  { path: 'diff',     element: <DiffView /> },
                  { path: 'review',   element: <ReviewerView /> },
                  { path: 'sign',     element: <ESignature /> },
                  { path: 'final',    element: <FinalDocument /> },
                ],
              },
            ],
          },
          {
            path: 'scientific-writing',
            children: [
              { index: true,                                element: <ScientificWritingHome /> },
              { path: 'new',                                element: <NewPublicationWizard /> },
              { path: 'portfolio',                          element: <SciPortfolioDashboard /> },
              {
                path: 'publications/:publicationId',
                children: [
                  { index: true,             element: <ManuscriptEditor /> },
                  { path: 'literature',      element: <PlaceholderScreen name="Literature & Citation Panel (B04)" /> },
                  { path: 'authors',         element: <AuthorManagement /> },
                  { path: 'submission',      element: <JournalSubmissionReadiness /> },
                  { path: 'submission-readiness', element: <JournalSubmissionReadiness /> },
                  { path: 'congress-export', element: <CongressAbstractExport /> },
                  { path: 'peer-review',     element: <PeerReviewResponse /> },
                  { path: 'final',           element: <FinalOutput /> },
                ],
              },
            ],
          },
          {
            path: 'medical-writing',
            children: [
              { index: true,           element: <MedicalWritingHome /> },
              { path: 'kol-session',   element: <KOLAdvisoryBoardSession /> },
              { path: 'claims-matrix', element: <ClaimsMatrixPanel /> },
              { path: 'portfolio',     element: <ContentPortfolio /> },
              {
                path: 'content/:contentId',
                children: [
                  { index: true,         element: <ContentBriefing /> },
                  { path: 'editor',      element: <ContentEditor /> },
                  { path: 'pre-mlr',     element: <PreMLRCheckPanel /> },
                  { path: 'mlr-review',  element: <MLRReview /> },
                  { path: 'formatting',  element: <FormattingAccessibility /> },
                  { path: 'final',       element: <MedFinalOutput /> },
                ],
              },
            ],
          },
          {
            path: 'regulatory-writing',
            children: [
              { index: true,                        element: <RegulatoryWritingHome /> },
              { path: 'intelligence',               element: <RegulatoryIntelligence /> },
              {
                path: 'submissions/:submissionId',
                children: [
                  { index: true,                    element: <SubmissionSetupStrategy /> },
                  { path: 'ectd-map',              element: <ECTDGranularityMap /> },
                  { path: 'module2-editor',        element: <CTDModule2Editor /> },
                  { path: 'finalisation',          element: <CMCNonclinicalFinalisation /> },
                  { path: 'super-review',          element: <SuperReview /> },
                  { path: 'publishing',            element: <ECTDPublishingMonitor /> },
                  { path: 'redaction',             element: <PPDCCIRedactionTool /> },
                  { path: 'gateway',               element: <GatewaySubmission /> },
                  { path: 'ha-response',           element: <HAResponseDrafting /> },
                  { path: 'final',                 element: <FinalOutputPortfolio /> },
                ],
              },
            ],
          },
          {
            path: 'ideation-publishing',
            children: [
              { index: true,             element: <IdeationPublishingHome /> },
              { path: 'calendar',        element: <ContentCalendar /> },
              { path: 'publishing',      element: <PublishingMonitor /> },
              {
                path: 'projects/:ideationProjectId',
                children: [
                  { index: true,          element: <ArtefactUploadSourceCheck /> },
                  { path: 'tagging',      element: <ContentCardTagging /> },
                  { path: 'compliance',   element: <PreReviewComplianceScreen /> },
                  { path: 'ma-approval',  element: <MedicalAffairsApproval /> },
                  { path: 'final',        element: <FinalOutputPublishingRecord /> },
                  { path: 'standards',    element: <StandardsMetadataDOI /> },
                ],
              },
            ],
          },
        ],
      },
    ],
  },
  // PUBLIC — outside AuthGuard/AppShell — KOL review link with token
  { path: '/kol-review/:token', element: <KOLReviewInterface /> },
  { path: '*', element: <Navigate to="/projects" replace /> },
])
