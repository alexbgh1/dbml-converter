import { Component } from '@angular/core';

@Component({
  selector: 'app-docs',
  templateUrl: './docs.component.html',
  host: {
    class:
      ' flex flex-col flex-1 overflow-auto p-6 lg:p-12 bg-bg-primary text-text',
  },
})
export class DocsComponent {}
