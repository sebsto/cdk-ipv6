import * as cdk from 'aws-cdk-lib';
import * as Code from '../lib/code-stack';

test('Empty Stack', () => {
    const app = new cdk.App();
    // WHEN
    const stack = new Code.CodeStack(app, 'MyTestStack');
    // THEN
    const actual = app.synth().getStackArtifact(stack.artifactId).template;
    expect(actual.Resources ?? {}).toEqual({});
});
