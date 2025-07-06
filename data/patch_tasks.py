#!/usr/bin/env python3
import json
import sys
import argparse


def main():
    parser = argparse.ArgumentParser(description='Apply patches and removals to task files')
    parser.add_argument('--input', default='originalTasks.jsonl', help='Input file (default: originalTasks.jsonl)')
    parser.add_argument('--output', default='patchedTasks.jsonl', help='Output file (default: patchedTasks.jsonl)')
    parser.add_argument('--patches', default='patches.json', help='Patches file (default: patches.json)')
    parser.add_argument('--removals-output', help='Optional: Output file for removed task IDs')
    args = parser.parse_args()
    
    # Read patches
    with open(args.patches, 'r') as f:
        patches = json.load(f)
    
    # Separate patches and removals
    update_patches = {}
    removal_ids = set()
    
    for task_id, patch_info in patches.items():
        if patch_info.get('remove', False):
            removal_ids.add(task_id)
        elif 'prev' in patch_info and 'new' in patch_info:
            update_patches[task_id] = patch_info
    
    print(f"Loaded {len(update_patches)} update patches and {len(removal_ids)} removals")
    
    # Process tasks
    total_count = 0
    patched_count = 0
    removed_count = 0
    written_count = 0
    removed_tasks = []
    
    with open(args.input, 'r') as input_file, \
         open(args.output, 'w') as output_file:
        
        for line in input_file:
            total_count += 1
            task = json.loads(line.strip())
            task_id = task['id']
            
            # Check if this task should be removed
            if task_id in removal_ids:
                removed_count += 1
                removed_tasks.append(task_id)
                continue
            
            # Check if this task has a patch
            if task_id in update_patches:
                patch = update_patches[task_id]
                # Verify the original task matches
                if task['ques'] == patch['prev']:
                    task['ques'] = patch['new']
                    patched_count += 1
                else:
                    print(f"Warning: Task {task_id} doesn't match expected text", file=sys.stderr)
                    print(f"  Expected: {patch['prev']}", file=sys.stderr)
                    print(f"  Found: {task['ques']}", file=sys.stderr)
            
            # Write the task (patched or original)
            output_file.write(json.dumps(task) + '\n')
            written_count += 1
    
    # Optionally save removed task IDs
    if args.removals_output:
        with open(args.removals_output, 'w') as f:
            json.dump(removed_tasks, f, indent=2)
        print(f"Saved {len(removed_tasks)} removed task IDs to {args.removals_output}")
    
    print(f"\nSummary:")
    print(f"  Total tasks processed: {total_count}")
    print(f"  Tasks updated: {patched_count}")
    print(f"  Tasks removed: {removed_count}")
    print(f"  Tasks written to output: {written_count}")
    print(f"  Unused patches: {len(update_patches) - patched_count}")


if __name__ == '__main__':
    main()