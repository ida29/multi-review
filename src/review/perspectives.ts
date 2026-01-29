import type { ReviewPerspective } from '../types.js';

/** Human-readable label for each perspective */
export const PERSPECTIVE_LABELS: Record<ReviewPerspective, string> = {
  logic: 'Logic & Correctness',
  security: 'Security',
  design: 'Design & Architecture',
  performance: 'Performance & Scalability',
  ux: 'UI/UX & Accessibility',
  testing: 'Testing',
};

/**
 * Perspective-specific review instructions.
 * Each perspective gets a focused system prompt supplement that narrows the reviewer's attention.
 */
export function getPerspectiveInstructions(perspective: ReviewPerspective): string {
  switch (perspective) {
    case 'logic':
      return LOGIC_INSTRUCTIONS;
    case 'security':
      return SECURITY_INSTRUCTIONS;
    case 'design':
      return DESIGN_INSTRUCTIONS;
    case 'performance':
      return PERFORMANCE_INSTRUCTIONS;
    case 'ux':
      return UX_INSTRUCTIONS;
    case 'testing':
      return TESTING_INSTRUCTIONS;
  }
}

// ─── Perspective Instructions ────────────────────────────────

const LOGIC_INSTRUCTIONS = `## Your Review Focus: Logic & Correctness

You are reviewing this code specifically for **logical correctness and bugs**. Ignore style, naming, and other aspects — focus only on:

### What to look for:
- **Bugs**: Off-by-one errors, null/undefined dereferences, incorrect conditionals, wrong operator usage
- **Edge cases**: Empty arrays/strings, zero values, negative numbers, boundary conditions, concurrent access
- **Control flow**: Unreachable code, missing break/return, infinite loops, unhandled promise rejections
- **Type safety**: Unsafe type casts, any-typed values used unsafely, missing type narrowing
- **Data integrity**: Race conditions, stale closures, mutation of shared state, incorrect merge/spread
- **Error paths**: Unhandled error cases, catch blocks that swallow errors silently, missing finally cleanup
- **API contracts**: Return values not matching declared types, missing required fields, wrong argument order`;

const SECURITY_INSTRUCTIONS = `## Your Review Focus: Security (OWASP-aligned)

You are reviewing this code specifically for **security vulnerabilities**. Ignore style, naming, and other aspects — focus only on:

### What to look for (OWASP Top 10 aligned):
- **Injection**: SQL injection, NoSQL injection, command injection, LDAP injection, template injection
- **Broken auth**: Hardcoded secrets/credentials, weak password handling, missing auth checks, JWT misuse
- **Sensitive data exposure**: Logging secrets/PII, unencrypted storage, missing data masking, secrets in source
- **XSS**: Unsanitized user input rendered in HTML, missing output encoding, dangerouslySetInnerHTML
- **Insecure deserialization**: Parsing untrusted JSON/YAML without validation, prototype pollution
- **SSRF**: Unvalidated URLs used for server-side requests, missing allowlist for external calls
- **Access control**: Missing authorization checks, IDOR (insecure direct object references), privilege escalation
- **CSRF**: Missing CSRF tokens in forms/state-changing endpoints
- **Dependency risks**: Known vulnerable packages, outdated dependencies, unpinned versions
- **Cryptography**: Weak algorithms (MD5, SHA1 for security), missing salt, predictable random values`;

const DESIGN_INSTRUCTIONS = `## Your Review Focus: Design & Architecture

You are reviewing this code specifically for **design quality, DRY, SOLID, DDD, and codebase consistency**. Ignore security and performance — focus only on:

### What to look for:

#### DRY (Don't Repeat Yourself)
- Duplicated logic that should be extracted into shared functions/utilities
- Copy-pasted code blocks with minor variations
- Repeated patterns that could be generalized with abstractions

#### SOLID Principles
- **SRP**: Classes/functions doing too many things, god objects, mixed concerns
- **OCP**: Code that requires modifying existing code to add new features (should extend instead)
- **LSP**: Subclasses that break parent class contracts
- **ISP**: Bloated interfaces forcing implementations of unused methods
- **DIP**: High-level modules depending directly on low-level implementations (should use abstractions/ports)

#### DDD (Domain-Driven Design) — when the project uses it
- Domain logic leaking into infrastructure/presentation layers
- Anemic domain models (entities with only getters/setters, no behavior)
- Missing or incorrect bounded context boundaries
- Ubiquitous language violations (code names not matching business terminology)
- Infrastructure concerns contaminating domain entities

#### Code Consistency
- New code not following existing patterns/conventions in the surrounding codebase
- Inconsistent naming conventions (camelCase vs snake_case, etc.)
- Breaking established architectural patterns without justification
- Missing index.ts barrel exports where the project uses them`;

const PERFORMANCE_INSTRUCTIONS = `## Your Review Focus: Performance & Scalability

You are reviewing this code specifically for **performance bottlenecks and scalability issues**. Ignore style and design — focus only on:

### What to look for:

#### Database & Queries
- **N+1 queries**: Loops that trigger individual DB queries (should batch/join)
- **Missing indexes**: Queries filtering/sorting on non-indexed columns
- **SELECT ***: Fetching all columns when only a few are needed
- **Unbounded queries**: Missing LIMIT/pagination, could return millions of rows
- **Missing WHERE clauses**: Full table scans on growing tables
- **Heavy joins without necessity**: Joins that could be avoided with denormalization or caching

#### Data Growth (when DB records increase)
- Code that assumes small datasets (in-memory sorting/filtering of DB results)
- Missing pagination for list endpoints
- Aggregation queries without proper indexing
- Counting with COUNT(*) on large tables without optimization

#### Runtime Performance
- **Memory leaks**: Event listeners not cleaned up, growing arrays/maps without bounds, missing cleanup in useEffect
- **Unnecessary re-renders**: Missing React.memo, unstable references in deps, inline object/function creation
- **Blocking operations**: Synchronous file I/O, CPU-intensive work on main thread
- **Missing caching**: Repeated expensive computations, API calls without caching
- **Unnecessary allocations**: Creating objects/arrays in hot loops, string concatenation in loops

#### Network & I/O
- Sequential API calls that could be parallelized (Promise.all)
- Missing request deduplication
- Large payloads without compression or streaming
- Missing connection pooling`;

const UX_INSTRUCTIONS = `## Your Review Focus: UI/UX & Accessibility

You are reviewing this code specifically for **UI correctness, responsive design, and accessibility**. Ignore backend logic — focus only on:

### What to look for:

#### Layout & Responsive Design
- Fixed widths/heights that break on different screen sizes
- Missing responsive breakpoints (mobile, tablet, desktop)
- Horizontal scrolling caused by overflow
- Text that overflows containers or gets cut off
- Touch targets too small (< 44x44px) for mobile
- Images without proper aspect ratio handling (stretching/squishing)

#### UI Robustness (when data grows)
- Long text/names that break layouts (no text truncation/ellipsis)
- Empty states not handled (empty lists, missing data)
- Loading states missing (spinner, skeleton)
- Error states not displayed to the user
- Tables/lists that collapse with zero or thousands of items

#### Accessibility (a11y / WCAG 2.1 AA)
- Missing semantic HTML (div/span instead of button, nav, main, section)
- Click handlers on non-interactive elements without role/tabIndex
- Images without alt text
- Form inputs without associated labels
- Missing ARIA attributes where needed
- Color contrast below 4.5:1 ratio
- Missing keyboard navigation support
- No prefers-reduced-motion support for animations
- Focus management issues (focus traps, missing focus indicators)

#### Testing Library Principles (https://testing-library.com/)
- Tests querying by implementation details (class names, IDs) instead of user-visible content
- Missing accessible roles/labels that would enable proper testing
- Components not testable by users' perspective (what users see and interact with)`;

const TESTING_INSTRUCTIONS = `## Your Review Focus: Testing

You are reviewing this code specifically for **test quality, coverage, and testing best practices**. Ignore style and design — focus only on:

### What to look for:

#### Missing Tests
- New logic/functions without corresponding unit tests
- Modified behavior without updated tests
- Edge cases not covered by existing tests
- Error/failure paths not tested
- Integration points without integration tests

#### Test Quality
- **AAA pattern**: Tests should follow Arrange → Act → Assert structure
- **Assertion quality**: Tests that pass without meaningful assertions (false positives)
- **Test isolation**: Tests that depend on execution order or shared mutable state
- **Flaky tests**: Tests relying on timing, network, or non-deterministic behavior
- **Over-mocking**: Mocking so much that tests don't verify real behavior
- **Testing implementation**: Tests coupled to internal implementation details, not behavior

#### Testing Library Best Practices
- Prefer queries that reflect how users interact: getByRole, getByLabelText, getByText
- Avoid getByTestId when accessible queries are available
- Test user behavior, not component internals
- Ensure components are accessible enough to be found by accessible queries

#### Test Coverage Gaps
- Critical business logic without tests
- API endpoint handlers without request/response tests
- State management transitions without verification
- Validation rules without boundary tests`;
